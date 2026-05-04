

import * as THREE from 'three';
import { createScene } from './scene.js';
import { Robot } from './robot.js';
import { createEndEffector } from './endEffectors.js';
import { solveIK, IKTracker } from './ik.js';
import { ScriptRunner } from './scripting.js';
import { JointPlot } from './plot.js';
import { MiniPhysics } from './physics.js';
import { Conveyor } from './conveyor.js';
import { CameraFeed } from './cameraFeed.js';
import { UI } from './ui.js';
import { installShortcuts } from './shortcuts.js';
import { Sound } from './sound.js';
import { Theme } from './theme.js';
import { Loading } from './loading.js';
import {
  robotToJSON, jsonToRobot,
  robotToURDF, urdfToRobot,
  downloadText, readFileAsText,
} from './persistence.js';

document.body.classList.add('app-loaded');

// Topbar theme + sound controls.
{
  const accentEl = document.getElementById('topbar-accent');
  if (accentEl) {
    accentEl.value = Theme.load().accent;
    accentEl.addEventListener('input', () => Theme.set({ accent: accentEl.value }));
  }
  const soundEl = document.getElementById('topbar-sound');
  if (soundEl) {
    soundEl.addEventListener('change', (e) => Sound.setEnabled(e.target.checked));
  }
}

// Click sound on every topbar/right-panel button.
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.tagName === 'BUTTON') Sound.click();
});

const viewport = document.getElementById('viewport');
const scene3d = createScene(viewport);
const { scene, camera, renderer, orbit, transform } = scene3d;




const robots = [new Robot(scene)];
let activeRobotIdx = 0;
const robot = new Proxy({}, {
  get(_t, prop) {
    if (prop === '__active') return robots[activeRobotIdx];
    const tgt = robots[activeRobotIdx];
    const v = tgt[prop];
    return typeof v === 'function' ? v.bind(tgt) : v;
  },
  set(_t, prop, val) { robots[activeRobotIdx][prop] = val; return true; },
  has(_t, prop) { return prop in robots[activeRobotIdx]; },
});
const physics = new MiniPhysics(scene);
const conveyor = new Conveyor(scene, physics, {
  center: new THREE.Vector3(0, 0.04, -0.7),
  dir: new THREE.Vector3(1, 0, 0),
  length: 1.6,
  width: 0.30,
  speed: 0.18,
});
conveyor.setEnabled(false);

const cameraFeed = new CameraFeed(scene, () => robot.endEffectors.find(e => e.type === 'camera') || null, { physics });
cameraFeed.attachTo(viewport);
const plot = new JointPlot(document.getElementById('plot-canvas'), document.getElementById('plot-legend'));

const sim = {
  playing: false,
  time: 0,
  dt: 0.016,
  speed: 1.0,
  play() { this.playing = true; },
  pause() { this.playing = false; },
  stop() { this.playing = false; this.time = 0; },
  step() { app._stepOnce(this.dt); },
};

const traceState = {
  enabled: false,
  points: [],
  line: null,
  geom: null,
  maxPoints: 5000,
};

const ikTarget = (() => {
  const grp = new THREE.Group();
  grp.name = 'ik-target';
  const geom = new THREE.SphereGeometry(0.04, 16, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffaa44, emissive: 0x442200, transparent: true, opacity: 0.85 });
  const mesh = new THREE.Mesh(geom, mat);
  grp.add(mesh);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.005, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffaa44 }));
  ring.rotation.x = Math.PI / 2;
  grp.add(ring);
  grp.position.set(0.5, 0.6, 0.3);
  scene.add(grp);
  return { group: grp, mesh, ring };
})();

const ikTracker = new IKTracker(robot);

const simClock = {
  now() { return sim.time; },

  nextFrame(token) {
    return new Promise(resolve => {
      const handler = () => {
        if (token?.cancelled) return resolve();
        resolve();
      };
      app._scriptWaiters.push(handler);
    });
  },

  
  
  wakeUp() {
    if (!app._scriptWaiters.length) return;
    const w = app._scriptWaiters;
    app._scriptWaiters = [];
    for (const fn of w) { try { fn(); } catch (_) {} }
  },

  async wait(seconds, token) {
    const target = sim.time + seconds;
    while (!token?.cancelled && sim.time < target) {
      await this.nextFrame(token);
    }
  },
};

const scriptRunner = new ScriptRunner(robot, simClock, document.getElementById('script-output'), physics,  null);






const LASER_BEAM_LENGTH = 0.65;
const LASER_BURN_THRESHOLD = 0.4;
const _laserRay = new THREE.Raycaster();
const _laserOrigin = new THREE.Vector3();
const _laserDir = new THREE.Vector3();
const _laserBurn = new WeakMap();   

function _tickLasers(dt) {
  const lasers = robot.endEffectors.filter(e => e.type === 'laser');
  for (const ee of lasers) {
    let state = _laserBurn.get(ee);
    if (!ee.params.firing) {
      if (state?.body) physics.setBlockHighlight(state.body, false);
      _laserBurn.set(ee, { body: null, time: 0 });
      continue;
    }
    ee.tip.updateWorldMatrix(true, false);
    _laserOrigin.setFromMatrixPosition(ee.tip.matrixWorld);
    _laserDir.set(0, 1, 0).transformDirection(ee.tip.matrixWorld).normalize();
    _laserRay.set(_laserOrigin, _laserDir);
    _laserRay.near = 0;
    _laserRay.far = LASER_BEAM_LENGTH;

    const meshes = physics.bodies
      .filter(b => !(b.attachedTo && b.attachedTo.isObject3D))
      .map(b => b.mesh);
    const hits = _laserRay.intersectObjects(meshes, false);
    const hitMesh = hits[0]?.object;
    const hitBody = hitMesh ? physics.bodies.find(b => b.mesh === hitMesh) : null;

    if (state?.body && state.body !== hitBody) physics.setBlockHighlight(state.body, false);
    if (!hitBody) {
      _laserBurn.set(ee, { body: null, time: 0 });
      continue;
    }
    if (!state || state.body !== hitBody) state = { body: hitBody, time: 0 };
    state.time += dt;
    physics.setBlockHighlight(hitBody, true, 0xff3030);
    if (state.time >= LASER_BURN_THRESHOLD) {
      
      
      
      const slicePerp = new THREE.Vector3(_laserDir.z, 0, -_laserDir.x);
      physics.sliceBlock(hitBody, slicePerp);
      _laserBurn.set(ee, { body: null, time: 0 });
    } else {
      _laserBurn.set(ee, state);
    }
  }
}

const app = {
  robot, scene3d, sim, physics, plot, ikTracker, conveyor,
  robots,
  get activeRobotIdx() { return activeRobotIdx; },
  selected: null,
  gizmoMode: 'rotate',
  _scriptWaiters: [],

  onSelect(idx) {
    this.selected = idx;
    if (idx == null || !robot.joints[idx]) {
      transform.detach();
    } else {
      const j = robot.joints[idx];

transform.attach(j.articulator);
      transform.setMode(j.type === 'revolute' ? 'rotate' : 'translate');
    }
    ui.refreshHierarchy();
    ui.refreshInspector();
  },

  setGizmoMode(mode) {
    this.gizmoMode = mode;
    if (mode === 'off') transform.detach();
    else transform.setMode(mode);
    document.querySelectorAll('.overlay-gizmo-mode button').forEach(b =>
      b.classList.toggle('active', b.dataset.gizmo === mode));
    if (mode !== 'off' && this.selected != null && robot.joints[this.selected]) {
      transform.attach(robot.joints[this.selected].articulator);
    }
  },

  toggleGizmo() {
    if (transform.object) transform.detach();
    else if (this.selected != null && robot.joints[this.selected]) {
      transform.attach(robot.joints[this.selected].articulator);
    }
  },

  refreshUI() { ui.refreshAll(); },

  spawnRobot(opts = {}) {
    const r = new Robot(scene);
    
    const idx = robots.length;
    r.rootGroup.position.x = opts.x ?? (idx * 1.4);
    if (opts.z != null) r.rootGroup.position.z = opts.z;
    robots.push(r);
    this.setActiveRobot(robots.length - 1);
    return r;
  },

  removeRobot(idx) {
    if (robots.length <= 1) return;
    const r = robots[idx];
    if (!r) return;
    r.clear();
    scene.remove(r.rootGroup);
    robots.splice(idx, 1);
    if (activeRobotIdx >= robots.length) activeRobotIdx = robots.length - 1;
    this.setActiveRobot(activeRobotIdx);
  },

  setActiveRobot(idx) {
    if (idx < 0 || idx >= robots.length) return;
    activeRobotIdx = idx;
    transform.detach();
    this.selected = null;
    ikTracker.robot = robots[idx];
    scriptRunner.setRobot(robots[idx]);
    this.refreshUI();
    this._highlightActiveRobot();
  },

  _highlightActiveRobot() {
    
    for (let i = 0; i < robots.length; i++) {
      const dim = i !== activeRobotIdx;
      robots[i].rootGroup.traverse(o => {
        if (o.isMesh && o.material && 'opacity' in o.material) {
          o.material.transparent = dim ? true : false;
          o.material.opacity = dim ? 0.55 : 1.0;
        }
      });
    }
  },

loadPreset(name) {
    robot.clear();
    if (name === '6dof') {
      robot.addJoint({ type: 'revolute', axis: 'y', linkLength: 0.20, linkAxis: '+y' });
      robot.addJoint({ type: 'revolute', axis: 'x', linkLength: 0.30, linkAxis: '+y' });
      robot.addJoint({ type: 'revolute', axis: 'x', linkLength: 0.25, linkAxis: '+y' });
      robot.addJoint({ type: 'revolute', axis: 'y', linkLength: 0.10, linkAxis: '+y' });
      robot.addJoint({ type: 'revolute', axis: 'x', linkLength: 0.10, linkAxis: '+y' });
      robot.addJoint({ type: 'revolute', axis: 'y', linkLength: 0.08, linkAxis: '+y' });
    } else if (name === 'industrial') {
      
      
      robot.addJoint({ type: 'revolute', axis: 'y', linkLength: 0.18, linkAxis: '+y' });
      robot.addJoint({ type: 'revolute', axis: 'x', linkLength: 0.42, linkAxis: '+y' });
      robot.addJoint({ type: 'revolute', axis: 'x', linkLength: 0.36, linkAxis: '+y' });
      robot.addJoint({ type: 'revolute', axis: 'y', linkLength: 0.14, linkAxis: '+y' });
      robot.addJoint({ type: 'revolute', axis: 'x', linkLength: 0.10, linkAxis: '+y' });
      robot.addJoint({ type: 'revolute', axis: 'y', linkLength: 0.08, linkAxis: '+y' });
    } else if (name === 'scara') {
      
      
      
      
      
      robot.addJoint({ type: 'revolute',  axis: 'y', linkLength: 0.30, linkAxis: '+y' });
      robot.addJoint({ type: 'revolute',  axis: 'y', linkLength: 0.30, linkAxis: '+x' });
      robot.addJoint({ type: 'revolute',  axis: 'y', linkLength: 0.25, linkAxis: '+x' });
      robot.addJoint({ type: 'prismatic', axis: 'y', linkLength: 0.20, linkAxis: '-y',
                      min: -0.18, max: 0 });
      robot.addJoint({ type: 'revolute',  axis: 'y', linkLength: 0.05, linkAxis: '-y' });
    } else if (name === 'cartesian') {
      
      
      robot.addJoint({ type: 'prismatic', axis: 'x', linkLength: 0.10, linkAxis: '+x',
                      min: -0.30, max: 0.30 });
      robot.addJoint({ type: 'prismatic', axis: 'z', linkLength: 0.10, linkAxis: '+z',
                      min: -0.30, max: 0.30 });
      robot.addJoint({ type: 'prismatic', axis: 'y', linkLength: 0.20, linkAxis: '-y',
                      min: -0.20, max: 0.05 });
    }
    this.onSelect(null);
    this.refreshUI();
  },

setEndEffector(type) {
    if (type === 'none') {
      robot.detachAllEndEffectors();
    } else {
      const ee = createEndEffector(type);
      if (ee) robot.attachEndEffectorGroup(ee);
    }
  },

  addEndEffector(type) {
    if (!type || type === 'none') return null;
    const ee = createEndEffector(type);
    if (ee) robot.addEndEffector(ee);
    return ee;
  },

setTraceEnabled(v) {
    traceState.enabled = v;
    if (v && !traceState.line) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(traceState.maxPoints * 3), 3));
      geom.setDrawRange(0, 0);
      const mat = new THREE.LineBasicMaterial({ color: 0xffd57a });
      traceState.geom = geom;
      traceState.line = new THREE.Line(geom, mat);
      traceState.line.frustumCulled = false;
      scene.add(traceState.line);
    }
    if (traceState.line) traceState.line.visible = v;
  },

  clearTrace() {
    traceState.points = [];
    if (traceState.geom) traceState.geom.setDrawRange(0, 0);
  },

  _pushTrace(p) {
    if (!traceState.enabled || !traceState.geom) return;
    if (traceState.points.length === 0
      || traceState.points[traceState.points.length - 1].distanceTo(p) > 0.005) {
      traceState.points.push(p.clone());
      if (traceState.points.length > traceState.maxPoints) traceState.points.shift();
      const arr = traceState.geom.attributes.position.array;
      const n = traceState.points.length;
      for (let i = 0; i < n; i++) {
        arr[i * 3] = traceState.points[i].x;
        arr[i * 3 + 1] = traceState.points[i].y;
        arr[i * 3 + 2] = traceState.points[i].z;
      }
      traceState.geom.attributes.position.needsUpdate = true;
      traceState.geom.setDrawRange(0, n);
    }
  },

ikSolveOnce() {
    const t = this._ikTargetVec3();
    const r = solveIK(robot, t, {
      maxIter: parseInt(document.getElementById('ik-iter').value) || 20,
      tolerance: parseFloat(document.getElementById('ik-tol').value) || 0.005,
    });
    scriptRunner.log(`[ik] err=${r.error.toFixed(4)} iters=${r.iterations} ${r.converged ? 'OK' : 'no-conv'}`);
    ui.refreshSliders();
  },
  ikStartTracking() {
    ikTracker.tolerance = parseFloat(document.getElementById('ik-tol').value) || 0.005;
    ikTracker.maxIter = 8;
    ikTracker.start();
  },
  ikStopTracking() { ikTracker.stop(); },
  setIKTargetVisible(v) { ikTarget.group.visible = !!v; },
  _ikTargetVec3() {
    const x = parseFloat(document.getElementById('ik-x').value);
    let   y = parseFloat(document.getElementById('ik-y').value);
    const z = parseFloat(document.getElementById('ik-z').value);
    if (robot.floorClearance && y < robot.floorY + 0.02) y = robot.floorY + 0.02;
    ikTarget.group.position.set(x, y, z);
    ikTracker.target.set(x, y, z);
    return ikTracker.target;
  },

runScript() {
    scriptRunner.clearOutput();
    scriptRunner.setRobot(robot);
    const src = document.getElementById('script-area').value;

    if (!sim.playing) sim.play();
    scriptRunner.run(src);
  },
  runScriptText(src) {
    scriptRunner.clearOutput();
    scriptRunner.setRobot(robot);
    if (!sim.playing) sim.play();
    scriptRunner.run(src);
  },
  stopScript() { scriptRunner.stop(); },

saveJSON() {
    downloadText('robot.json', JSON.stringify(robotToJSON(robot), null, 2));
  },
  exportURDF() {
    downloadText('robot.urdf', robotToURDF(robot));
  },
  loadFromFile(kind, onSuccess, onError) {
    const inp = document.getElementById('file-input');
    inp.value = '';
    inp.accept = kind === 'urdf' ? '.urdf,.xml' : '.json';
    inp.onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const text = await readFileAsText(f);
        let info = { fileName: f.name, joints: 0, endEffectors: 0 };
        if (kind === 'urdf' || /\.urdf|\.xml/i.test(f.name)) {
          urdfToRobot(robot, text, (t) => { const ee = createEndEffector(t); if (ee) robot.addEndEffector(ee); return ee; });
          info = { ...info, type: 'URDF' };
        } else {
          const data = JSON.parse(text);
          jsonToRobot(robot, data, (t) => { const ee = createEndEffector(t); if (ee) robot.addEndEffector(ee); return ee; });
          info = {
            ...info,
            type: 'JSON',
            joints: Array.isArray(data.joints) ? data.joints.length : 0,
            endEffectors: Array.isArray(data.endEffectors) ? data.endEffectors.length : 0,
          };
        }
        this.onSelect(null);
        this.refreshUI();
        if (typeof onSuccess === 'function') onSuccess(info);
      } catch (err) {
        alert('Failed to load file: ' + err.message);
        if (typeof onError === 'function') onError(err);
      }
    };
    inp.click();
  },

_stepOnce(dt) {
    sim.time += dt;

    if (ikTracker.active) ikTracker.update();
    for (const ee of robot.endEffectors) ee.update?.(dt);
    physics.step(dt);
    _tickLasers(dt);

const q = robot.joints.map(j => j.value);
    plot.push(sim.time, q);

if (this._scriptWaiters.length) {
      const w = this._scriptWaiters;
      this._scriptWaiters = [];
      for (const fn of w) fn();
    }
  },
};

scriptRunner.app = app;

const ui = new UI({
  ...app,

  onSelect: (i) => app.onSelect(i),
  refreshUI: () => app.refreshUI(),
  loadPreset: (n) => app.loadPreset(n),
  setEndEffector: (t) => app.setEndEffector(t),
  addEndEffector: (t) => app.addEndEffector(t),
  setTraceEnabled: (v) => app.setTraceEnabled(v),
  clearTrace: () => app.clearTrace(),
  setGizmoMode: (m) => app.setGizmoMode(m),
  ikSolveOnce: () => app.ikSolveOnce(),
  ikStartTracking: () => app.ikStartTracking(),
  ikStopTracking: () => app.ikStopTracking(),
  setIKTargetVisible: (v) => app.setIKTargetVisible(v),
  runScript: () => app.runScript(),
  runScriptText: (src) => app.runScriptText(src),
  stopScript: () => app.stopScript(),
  saveJSON: () => app.saveJSON(),
  exportURDF: () => app.exportURDF(),
  loadFromFile: (k) => app.loadFromFile(k),
  spawnRobot: (o) => app.spawnRobot(o),
  removeRobot: (i) => app.removeRobot(i),
  setActiveRobot: (i) => app.setActiveRobot(i),
  get robots() { return app.robots; },
  get activeRobotIdx() { return app.activeRobotIdx; },
});

async function bootInitialContent() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');

  if (action === 'import') {
    const text = sessionStorage.getItem('pendingImportJSON');
    sessionStorage.removeItem('pendingImportJSON');
    sessionStorage.removeItem('pendingImportName');
    if (text) {
      try {
        const data = JSON.parse(text);
        const { jsonToRobot } = await import('./persistence.js');
        robot.clear();
        jsonToRobot(robot, data, (t) => { const ee = createEndEffector(t); if (ee) robot.addEndEffector(ee); return ee; });
        app.onSelect(null);
        return;
      } catch (err) {
        console.error('Import failed, falling back to preset:', err);
        alert('Failed to import JSON: ' + err.message);
      }
    }
    app.loadPreset('6dof');
    return;
  }

  app.loadPreset('6dof');
}

try {
  await bootInitialContent();
  ui.refreshAll();
  Loading.hide(250);
} catch (err) {
  Loading.hide();
  console.error('[RoboForge] boot failed:', err);
  const el = document.getElementById('boot-error');
  if (el) {
    el.style.display = 'block';
    el.textContent = 'Robot init failed: ' + (err && err.message ? err.message : err);
  }
}

{
  const _box = new THREE.Box3();
  const _size = new THREE.Vector3();
  const _center = new THREE.Vector3();
  robot.rootGroup.updateWorldMatrix(true, true);
  _box.setFromObject(robot.rootGroup);
  if (isFinite(_box.min.x) && !_box.isEmpty()) {
    _box.getCenter(_center);
    _box.getSize(_size);
    const radius = Math.max(_size.x, _size.y, _size.z) * 0.9 + 0.4;
    orbit.target.copy(_center);
    camera.position.set(_center.x + radius, _center.y + radius * 0.6, _center.z + radius);
    camera.lookAt(_center);
    orbit.update();
  }
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (transform.dragging) return;
  
  const candidates = [];
  for (const r of robots) candidates.push(...r.pickableObjects());
  candidates.push(ikTarget.mesh);
  const hit = scene3d.pickObject(e, candidates);
  if (!hit) return;
  if (hit.object === ikTarget.mesh || hit.object.parent === ikTarget.group) {
    transform.setMode('translate');
    transform.attach(ikTarget.group);
    return;
  }
  
  for (let i = 0; i < robots.length; i++) {
    const j = robots[i].jointFromObject(hit.object);
    if (j) {
      if (i !== activeRobotIdx) app.setActiveRobot(i);
      app.onSelect(robots[i].joints.indexOf(j));
      return;
    }
  }
});

transform.addEventListener('objectChange', () => {
  if (transform.object === ikTarget.group) {
    if (robot.floorClearance && ikTarget.group.position.y < robot.floorY + 0.02) {
      ikTarget.group.position.y = robot.floorY + 0.02;
    }
    document.getElementById('ik-x').value = ikTarget.group.position.x.toFixed(3);
    document.getElementById('ik-y').value = ikTarget.group.position.y.toFixed(3);
    document.getElementById('ik-z').value = ikTarget.group.position.z.toFixed(3);
    ikTracker.target.copy(ikTarget.group.position);
    return;
  }
  const idx = app.selected;
  if (idx == null) return;
  const j = robot.joints[idx];
  if (!j) return;

  const oldValue = j.value;
  if (j.type === 'revolute') {
    const e = new THREE.Euler().setFromQuaternion(j.articulator.quaternion, 'XYZ');
    const v = j.axis === 'x' ? e.x : (j.axis === 'y' ? e.y : e.z);
    j.value = THREE.MathUtils.clamp(v, j.min, j.max);
    robot._applyJointTransform(j);
  } else {
    const p = j.articulator.position;
    const v = j.axis === 'x' ? p.x : (j.axis === 'y' ? p.y : p.z);
    j.value = THREE.MathUtils.clamp(v, j.min, j.max);
    robot._applyJointTransform(j);
  }
  if (robot._hasViolation()) {
    j.value = oldValue;
    robot._applyJointTransform(j);
  }
});

installShortcuts({
  setGizmoMode: (m) => app.setGizmoMode(m),
  toggleGizmo: () => app.toggleGizmo(),
  togglePlay: () => sim.playing ? sim.pause() : sim.play(),
  step: () => sim.step(),
  stop: () => sim.stop(),
  selectJoint: (i) => app.onSelect(i),
  deselect: () => app.onSelect(null),
  deleteSelected: () => {
    if (app.selected != null) {
      const j = robot.joints[app.selected];
      if (j) robot.removeJoint(j.id);
      app.onSelect(null);
      app.refreshUI();
    }
  },
  nudgeSelected: (dir) => {
    if (app.selected == null) return;
    const j = robot.joints[app.selected];
    if (!j) return;
    const step = j.type === 'revolute' ? 0.05 : 0.01;
    robot.setJointValue(app.selected, j.value + dir * step);
    ui.refreshSliders();
  },
  frameView: () => {

    const c = new THREE.Vector3();
    robot.rootGroup.updateWorldMatrix(true, true);
    const ee = robot.getEndEffectorWorldPosition(c);
    orbit.target.set(0, ee.y * 0.5, 0);
  },
  saveJSON: () => app.saveJSON(),
});

const clock = new THREE.Clock();
const _eePos = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const wallDt = clock.getDelta();

if (sim.playing) {

    let budget = wallDt * sim.speed;
    let safety = 8;
    while (budget >= sim.dt && safety-- > 0) {
      app._stepOnce(sim.dt);
      budget -= sim.dt;
    }
  }

if (!sim.playing) for (const ee of robot.endEffectors) ee.update?.(wallDt);
  
  
  conveyor.step(wallDt);
  // Conveyor hum tracks enabled + speed.
  {
    const hum = Sound.motor('conveyor', 60);
    hum.setIntensity(conveyor.enabled ? Math.min(1, conveyor.speed / 0.5 + 0.15) : 0);
  }
  orbit.update();

robot.getEndEffectorWorldPosition(_eePos);
  app._pushTrace(_eePos);

ui.tickReadouts(_eePos, sim.time);
  plot.render();

  renderer.render(scene, camera);
  cameraFeed.step(wallDt);
}
animate();

window.app = app;
window.robot = robot;
window.THREE = THREE;
