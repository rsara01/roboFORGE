
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║ RoboForge - Drone Simulator Main Module                     ║
 * ║ Created by: Rishik Saravanan                                ║
 * ║ Birthday: May 25th                                          ║
 * ║ © 2024-2026. All rights reserved.                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { Theme } from './theme.js';
import { Sound } from './sound.js';
import { Loading } from './loading.js';
import { DronePhysics } from './drone-physics.js';
import { DroneController } from './drone-pid.js';
import { City } from './drone-city.js';
import { buildDroneMesh } from './drone-mesh.js';
import { Sentry } from './drone-sentry.js';
import { exportDroneKit, exportJSON } from './drone-export.js';
import { TelemetryPlot } from './drone-telemetry.js';
import { DroneScriptRunner, DRONE_SCRIPT_EXAMPLES } from './drone-scripting.js';

const viewport = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec3e6);
scene.fog = new THREE.Fog(0x9ec3e6, 200, 1500);

const camera = new THREE.PerspectiveCamera(60, viewport.clientWidth / viewport.clientHeight, 0.05, 6000);
camera.position.set(6, 4, 8);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 1, 0);
orbit.enableDamping = true;
orbit.zoomSpeed = 2.4;
orbit.panSpeed = 1.2;
orbit.rotateSpeed = 0.9;
orbit.minDistance = 1.0;
orbit.maxDistance = 4000;

const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(120, 220, 90);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -220; sun.shadow.camera.right = 220;
sun.shadow.camera.top = 220; sun.shadow.camera.bottom = -220;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 800;
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));

const terrain = new City(scene);

const physics = new DronePhysics();

physics.groundHeightFn = () => 0;
physics.collideFn = (pos, vel, r) => terrain.collide(pos, vel, r);
physics.collideRadius = 0.55;
const controller = new DroneController(physics);

function spawnDrone(xz = new THREE.Vector2(0, 0)) {
  const h = terrain.heightAt(xz.x, xz.y);
  physics.reset(new THREE.Vector3(xz.x, h + 1.5, xz.y));
  controller.reset();
  target.set(xz.x, h + 2.0, xz.y);
  controller.setTarget(target);
}

const droneMesh = buildDroneMesh();
scene.add(droneMesh.group);

const sentry = new Sentry({ scene, renderer, camera, orbit, target: () => physics.position });
sentry.setDronePhysics(physics);

function reseatSentry() {
  const sx = sentry.group.position.x, sz = sentry.group.position.z;
  sentry.group.position.y = terrain.heightAt(sx, sz);
}

const droneCam = new THREE.PerspectiveCamera(90, 320 / 200, 0.02, 4000);
const camCanvas = document.getElementById('cam-canvas');
const camRenderer = new THREE.WebGLRenderer({ antialias: true, canvas: camCanvas });
camRenderer.setPixelRatio(1);
camRenderer.setSize(320, 200, false);
camRenderer.outputColorSpace = THREE.SRGBColorSpace;

let fpvMode = false;
function toggleFPV() {
  fpvMode = !fpvMode;

  orbit.enabled = !fpvMode;
  const label = document.querySelector('#cam-feed .label');
  if (label) label.textContent = fpvMode ? 'CHASE CAM' : 'DRONE CAM';
  const btn = document.getElementById('btn-fpv');
  if (btn) btn.classList.toggle('primary', fpvMode);
}

const FlightMode = { HOVER: 'HOVER', MANUAL: 'MANUAL', MISSION: 'MISSION' };
let mode = FlightMode.HOVER;
const target = new THREE.Vector3(0, 1.5, 0);
controller.setTarget(target);

const waypoints = [];
let recording = false;
let recordTimer = 0;

const mission = { waypoints: [], idx: 0, holdTime: 0 };

const keys = new Set();
const STICK_KEYS = new Set([
  'w','a','s','d','q','e',
  'arrowup','arrowdown','arrowleft','arrowright',
  'v','g','f',
]);
let speedScale = 1.0;
window.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  const k = e.key.toLowerCase();
  if (STICK_KEYS.has(k)) e.preventDefault();
  keys.add(k);
  if (k === 'g') sentry.toggle();
  if (k === 'v' || k === 'f') toggleFPV();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function applyManualInput(dt) {
  const pitch    = (keys.has('w')          ? 1 : 0) - (keys.has('s')         ? 1 : 0);
  const roll     = (keys.has('d')          ? 1 : 0) - (keys.has('a')         ? 1 : 0);
  const throttle = (keys.has('arrowup')    ? 1 : 0) - (keys.has('arrowdown') ? 1 : 0);
  const yawIn    = (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0)
                 + (keys.has('e')          ? 1 : 0) - (keys.has('q')         ? 1 : 0);

  if (mode === FlightMode.MANUAL) {
    controller.setManualInput({
      pitch,
      roll,
      yawRate: yawIn,
      climbRate: throttle,
    });
    const minH = terrain.heightAt(physics.position.x, physics.position.z) + 0.5;
    if (controller.target.y < minH) controller.target.y = minH;
    return;
  }

  if (!throttle && !yawIn && !pitch && !roll) return;

  const climbSpeed = 5.0 * speedScale;
  const yawSpeed   = 1.8 * speedScale;
  const moveSpeed  = 6.0 * speedScale;

  if (throttle) {
    target.y += throttle * climbSpeed * dt;
    const minH = terrain.heightAt(target.x, target.z) + 0.5;
    if (target.y < minH) target.y = minH;
  }
  if (yawIn) {
    controller.targetYaw += yawIn * yawSpeed * dt;
  }
  if (pitch || roll) {
    const yaw = controller.targetYaw;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    target.x += (pitch * sy + roll * cy) * moveSpeed * dt;
    target.z += (pitch * cy - roll * sy) * moveSpeed * dt;
  }
  controller.setTarget(target);
}

let placeMode = false;
renderer.domElement.addEventListener('click', (e) => {
  if (sentry.equipped) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);

  const hit = traceGround(ray.ray, terrain);
  if (!hit) return;

  if (placeMode) {
    placeMode = false;
    renderer.domElement.style.cursor = '';
    spawnDrone(new THREE.Vector2(hit.x, hit.z));
    droneMesh.setStatus('ok');
    Sound.ok();
    return;
  }

  if (mode === FlightMode.HOVER) {
    target.x = hit.x;
    target.z = hit.z;
    target.y = Math.max(target.y, hit.y + 2.0);
    controller.setTarget(target);
    Sound.beep();
  }
});

function traceGround(ray, terrain) {

  const o = ray.origin, d = ray.direction;
  const maxT = 800;
  const step = 2.0;
  let prevT = 0;
  let prevDelta = (o.y) - terrain.heightAt(o.x, o.z);
  for (let t = step; t < maxT; t += step) {
    const px = o.x + d.x * t;
    const py = o.y + d.y * t;
    const pz = o.z + d.z * t;
    const delta = py - terrain.heightAt(px, pz);
    if (delta < 0 && prevDelta >= 0) {

      let lo = prevT, hi = t;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        const mx = o.x + d.x * mid;
        const my = o.y + d.y * mid;
        const mz = o.z + d.z * mid;
        const md = my - terrain.heightAt(mx, mz);
        if (md < 0) hi = mid; else lo = mid;
      }
      const tHit = (lo + hi) / 2;
      return new THREE.Vector3(o.x + d.x * tHit, o.y + d.y * tHit, o.z + d.z * tHit);
    }
    prevT = t; prevDelta = delta;
  }
  return null;
}

Theme.apply();
const accentEl = document.getElementById('topbar-accent');
accentEl.value = Theme.load().accent;
accentEl.addEventListener('input', () => Theme.set({ accent: accentEl.value }));
document.getElementById('topbar-sound').addEventListener('change', (e) => Sound.setEnabled(e.target.checked));
document.addEventListener('click', (e) => { if (e.target?.tagName === 'BUTTON') Sound.click(); });

function setMode(m) {
  const prev = mode;
  mode = m;
  controller.reset();
  if (m === FlightMode.MANUAL) {
    target.copy(physics.position);
    controller.setTarget(target, physics.getEuler().yaw);
    controller.setManualInput({});
  } else {
    controller.clearManualInput();
    if (prev === FlightMode.MANUAL) {
      target.copy(physics.position);
      controller.setTarget(target, physics.getEuler().yaw);
    }
  }
  document.getElementById('hud-mode').textContent = m;
  for (const id of ['mode-hover', 'mode-manual', 'mode-mission']) {
    document.getElementById(id).classList.remove('primary');
  }
  const map = { HOVER: 'mode-hover', MANUAL: 'mode-manual', MISSION: 'mode-mission' };
  document.getElementById(map[m]).classList.add('primary');
}
document.getElementById('mode-hover').addEventListener('click', () => setMode(FlightMode.HOVER));
document.getElementById('mode-manual').addEventListener('click', () => setMode(FlightMode.MANUAL));
document.getElementById('mode-mission').addEventListener('click', () => {
  if (waypoints.length === 0) { Sound.err(); return; }
  mission.waypoints = waypoints.map(p => p.clone());
  mission.idx = 0;
  mission.holdTime = 0;
  setMode(FlightMode.MISSION);
});
setMode(FlightMode.HOVER);

document.getElementById('btn-reset').addEventListener('click', () => {
  spawnDrone(new THREE.Vector2(physics.position.x, physics.position.z));
  droneMesh.setStatus('ok');
  Sound.ok();
});
document.getElementById('btn-place').addEventListener('click', () => {
  placeMode = true;
  Sound.beep();
  renderer.domElement.style.cursor = 'crosshair';
});
document.getElementById('btn-sentry').addEventListener('click', () => sentry.toggle());

const wpListEl = document.getElementById('wp-list');
function renderWaypoints() {
  wpListEl.innerHTML = '';
  if (waypoints.length === 0) {
    wpListEl.innerHTML = '<div class="empty">No waypoints yet</div>';
    return;
  }
  waypoints.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'wp';
    row.innerHTML = `<span>#${i + 1}</span><span>${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}</span>`;
    wpListEl.appendChild(row);
  });
}
document.getElementById('btn-record').addEventListener('click', () => { recording = true; Sound.beep(); });
document.getElementById('btn-stop-record').addEventListener('click', () => { recording = false; Sound.beep(); });
document.getElementById('btn-clear-wp').addEventListener('click', () => { waypoints.length = 0; renderWaypoints(); pathLine.update(waypoints); });
document.getElementById('btn-export-py').addEventListener('click', () => {
  if (!waypoints.length) { alert('No waypoints to export. Record a flight first.'); return; }
  download(exportDroneKit(waypoints, terrain.origin), 'roboforge_mission.py', 'text/x-python');
});
document.getElementById('btn-export-json').addEventListener('click', () => {
  if (!waypoints.length) { alert('No waypoints to export. Record a flight first.'); return; }
  download(exportJSON(waypoints, terrain.origin), 'roboforge_mission.json', 'application/json');
});
function download(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 200);
}

document.getElementById('btn-fpv').addEventListener('click', toggleFPV);

const pidBlocks = document.getElementById('pid-blocks');
const PID_GROUPS = [
  { key: 'pos',     name: 'Position (XZ)',   range: { kp: 4,  ki: 1,   kd: 1 } },
  { key: 'vel',     name: 'Velocity → Tilt', range: { kp: 1,  ki: 0.2, kd: 0.4 } },
  { key: 'alt',     name: 'Altitude',        range: { kp: 12, ki: 6,   kd: 8 } },
  { key: 'yaw',     name: 'Yaw → Rate',      range: { kp: 6,  ki: 1,   kd: 1 } },
  { key: 'att',     name: 'Attitude (R/P)',  range: { kp: 16, ki: 1,   kd: 4 } },
  { key: 'yawRate', name: 'Yaw Rate',        range: { kp: 2,  ki: 0.5, kd: 0.5 } },
];
function renderPID() {
  pidBlocks.innerHTML = '';
  for (const g of PID_GROUPS) {
    const block = document.createElement('div');
    block.className = 'pid-block';
    block.innerHTML = `<div class="name">${g.name}</div>`;
    for (const k of ['kp', 'ki', 'kd']) {
      const v = controller.gains[g.key][k];
      const max = g.range[k];
      const row = document.createElement('div');
      row.className = 'gain';
      row.innerHTML = `
        <label>${k.toUpperCase()}</label>
        <input type="range" min="0" max="${max}" step="${(max / 200).toFixed(4)}" value="${v}" />
        <span class="v">${v.toFixed(2)}</span>
      `;
      const slider = row.querySelector('input');
      const valEl  = row.querySelector('.v');
      slider.addEventListener('input', () => {
        const nv = parseFloat(slider.value);
        controller.setGain(g.key, k, nv);
        valEl.textContent = nv.toFixed(2);
      });
      block.appendChild(row);
    }
    pidBlocks.appendChild(block);
  }
}
renderPID();
document.getElementById('btn-pid-reset').addEventListener('click', () => {
  const fresh = new DroneController(physics);
  controller.gains = fresh.gains;
  controller.reset();
  renderPID();
  Sound.ok();
});

const envGravity = document.getElementById('env-gravity');
const envDrag = document.getElementById('env-drag');
const windX = document.getElementById('wind-x');
const windZ = document.getElementById('wind-z');
const windXv = document.getElementById('wind-x-v');
const windZv = document.getElementById('wind-z-v');
envGravity.addEventListener('change', () => { physics.gravityEnabled = envGravity.checked; });
envDrag.addEventListener('change', () => { physics.dragEnabled = envDrag.checked; });
function syncWind() {
  physics.wind.set(parseFloat(windX.value), 0, parseFloat(windZ.value));
  windXv.textContent = parseFloat(windX.value).toFixed(1);
  windZv.textContent = parseFloat(windZ.value).toFixed(1);
}
windX.addEventListener('input', syncWind);
windZ.addEventListener('input', syncWind);
document.getElementById('btn-gust').addEventListener('click', () => {

  const a = Math.random() * Math.PI * 2;
  physics.applyImpulse(new THREE.Vector3(Math.cos(a) * 3, (Math.random() - 0.3) * 1.5, Math.sin(a) * 3));
  Sound.beep();
});

const scopeAlt = new TelemetryPlot(
  document.getElementById('scope-alt'),
  [{ name: 'alt', color: '#4ea1ff' }, { name: 'target', color: '#ffae42' }],
);
const scopeRPY = new TelemetryPlot(
  document.getElementById('scope-rpy'),
  [{ name: 'roll', color: '#ef5350' }, { name: 'pitch', color: '#66bb6a' }, { name: 'yaw', color: '#4ea1ff' }],
);
const scopeMotors = new TelemetryPlot(
  document.getElementById('scope-motors'),
  Array.from({ length: physics.numMotors }, (_, i) => ({
    name: `M${i}`,
    color: ['#4ea1ff','#ffae42','#ef5350','#66bb6a','#ab47bc','#26c6da','#ffd54f','#ff80ab'][i % 8],
  })),
  { yMin: 0 },
);
let telemetryT = 0;

const pathLine = (() => {
  const geo = new THREE.BufferGeometry();
  const mat = new THREE.LineBasicMaterial({ color: 0xffd166, linewidth: 2 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  return {
    update(points) {
      const arr = new Float32Array(points.length * 3);
      for (let i = 0; i < points.length; i++) {
        arr[i * 3 + 0] = points[i].x;
        arr[i * 3 + 1] = points[i].y;
        arr[i * 3 + 2] = points[i].z;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      geo.computeBoundingSphere();
    },
  };
})();

const hud = {
  pos: document.getElementById('hud-pos'),
  alt: document.getElementById('hud-alt'),
  vel: document.getElementById('hud-vel'),
  rpy: document.getElementById('hud-rpy'),
  hp:  document.getElementById('hud-hp'),
  status: document.getElementById('status-block'),
};
function tickHUD() {
  hud.pos.textContent = `${physics.position.x.toFixed(2)}, ${physics.position.z.toFixed(2)}`;
  const groundH = terrain.heightAt(physics.position.x, physics.position.z);
  hud.alt.textContent = `${physics.position.y.toFixed(2)} m  (AGL ${(physics.position.y - groundH).toFixed(2)})`;
  hud.vel.textContent = `${physics.velocity.length().toFixed(2)} m/s`;
  const e = physics.getEuler();
  const deg = (r) => (r * 180 / Math.PI).toFixed(0);
  hud.rpy.textContent = `${deg(e.roll)} ${deg(e.pitch)} ${deg(e.yaw)}`;
  hud.hp.textContent = Math.max(0, Math.round(physics.hp));
  hud.hp.style.color = physics.hp > 60 ? 'var(--ok)' : physics.hp > 25 ? 'var(--warn)' : 'var(--err)';
  hud.status.textContent = physics.wrecked ? 'WRECKED — press Reset' : (physics.armed ? 'Armed' : 'Disarmed');
  hud.status.style.color = physics.wrecked ? 'var(--err)' : 'var(--ok)';
}

function stepMission(dt) {
  if (mission.idx >= mission.waypoints.length) {
    setMode(FlightMode.HOVER);
    Sound.ok();
    return;
  }
  const wp = mission.waypoints[mission.idx];
  controller.setTarget(wp);
  const d = physics.position.distanceTo(wp);
  if (d < 0.5) {
    mission.holdTime += dt;
    if (mission.holdTime > 0.6) { mission.idx++; mission.holdTime = 0; Sound.beep(); }
  } else {
    mission.holdTime = 0;
  }
}

let lastUserInteract = 0;
['pointerdown', 'wheel'].forEach(ev => {
  renderer.domElement.addEventListener(ev, () => { lastUserInteract = performance.now(); });
});
function followCamera(dt) {
  if (sentry.equipped) return;

  const idle = performance.now() - lastUserInteract > 1500;
  if (!idle) return;
  const desired = physics.position.clone();

  orbit.target.lerp(desired, Math.min(1, dt * 2.5));
}

const SUBSTEPS = 4;
const clock = new THREE.Clock();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (!sentry.equipped) {
    applyManualInput(dt);
    if (mode === FlightMode.MISSION) stepMission(dt);
  }

  for (let i = 0; i < SUBSTEPS; i++) {
    const sdt = dt / SUBSTEPS;
    const ctl = controller.step(sdt);
    physics.applyControl(ctl.collective, ctl.moment);
    physics.step(sdt);
  }

  droneMesh.group.position.copy(physics.position);
  droneMesh.group.quaternion.copy(physics.quat);
  droneMesh.spinProps(dt, physics.armed && !physics.wrecked ? Math.max(0.2, physics.collective) : 0);
  droneMesh.setStatus(physics.wrecked ? 'wrecked' : 'ok');

  const intensity = physics.armed && !physics.wrecked ? Math.min(1, physics.collective + 0.1) : 0;
  Sound.motor('drone', 95).setIntensity(intensity);

  if (recording) {
    recordTimer += dt;
    if (recordTimer > 0.4) {
      const p = physics.position.clone();
      if (waypoints.length === 0 || waypoints[waypoints.length - 1].distanceTo(p) > 0.5) {
        waypoints.push(p);
        renderWaypoints();
        pathLine.update(waypoints);
      }
      recordTimer = 0;
    }
  }

  const camOffset = new THREE.Vector3(0, 0.005, 0.5).applyQuaternion(physics.quat);
  droneCam.position.copy(physics.position).add(camOffset);
  const camFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(physics.quat);
  droneCam.lookAt(droneCam.position.clone().add(camFwd));

  if (physics.wrecked && physics.onGround && !physics._boomed) {
    Sound.boom();
    physics._boomed = true;
  }
  if (!physics.wrecked) physics._boomed = false;

  sentry.step(dt);
  reseatSentry();
  followCamera(dt);
  orbit.update();
  tickHUD();

  telemetryT += dt;
  const eul = physics.getEuler();
  const rad2deg = 180 / Math.PI;
  scopeAlt.push(telemetryT, [physics.position.y, target.y]);
  scopeRPY.push(telemetryT, [eul.roll * rad2deg, eul.pitch * rad2deg, eul.yaw * rad2deg]);
  scopeMotors.push(telemetryT, physics.omega.slice());
  scopeAlt.render();
  scopeRPY.render();
  scopeMotors.render();

  const w = viewport.clientWidth, h = viewport.clientHeight;
  let mainCam;
  let previewCam;
  if (sentry.equipped) {
    mainCam = sentry.camera;
    previewCam = droneCam;
  } else if (fpvMode) {
    mainCam = droneCam;
    previewCam = camera;
  } else {
    mainCam = camera;
    previewCam = droneCam;
  }

  if (mainCam.aspect !== w / h) {
    mainCam.aspect = w / h;
    mainCam.updateProjectionMatrix();
  }
  if (previewCam.aspect !== 320 / 200) {
    previewCam.aspect = 320 / 200;
    previewCam.updateProjectionMatrix();
  }
  renderer.render(scene, mainCam);
  camRenderer.render(scene, previewCam);

  requestAnimationFrame(tick);
}

function resizeMain() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, true);
  sentry.camera.aspect = w / h;
  sentry.camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeMain);
new ResizeObserver(resizeMain).observe(viewport);
resizeMain();

const speedSlider = document.getElementById('drone-speed');
const speedSliderV = document.getElementById('drone-speed-v');
if (speedSlider) {
  speedSlider.addEventListener('input', () => {
    speedScale = parseFloat(speedSlider.value);
    speedSliderV.textContent = speedScale.toFixed(1) + 'x';
  });
}

document.querySelectorAll('#right-panel .tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.tab;
    document.querySelectorAll('#right-panel .tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('#right-panel .tab-panel').forEach(p => {
      p.classList.toggle('active', p.dataset.panel === t);
    });
  });
});

const scriptApi = {
  setTarget,
  position: () => ({ x: physics.position.x, y: physics.position.y, z: physics.position.z }),
  velocity: () => ({ x: physics.velocity.x, y: physics.velocity.y, z: physics.velocity.z }),
  yaw: () => physics.getEuler().yaw,
  setMode: (m) => {
    const map = { HOVER: FlightMode.HOVER, MANUAL: FlightMode.MANUAL, MISSION: FlightMode.MISSION };
    const fm = map[String(m).toUpperCase()];
    if (fm) setMode(fm);
  },
  setWind: (x, z) => {
    physics.wind.set(x, 0, z);
    windX.value = x; windZ.value = z;
    windXv.textContent = x.toFixed(1); windZv.textContent = z.toFixed(1);
  },
  gust: (vx, vy, vz) => {
    if (vx === undefined) {
      const a = Math.random() * Math.PI * 2;
      physics.applyImpulse(new THREE.Vector3(Math.cos(a) * 3, (Math.random() - 0.3) * 1.5, Math.sin(a) * 3));
    } else {
      physics.applyImpulse(new THREE.Vector3(vx, vy ?? 0, vz ?? 0));
    }
  },
  setGravity: (on) => { physics.gravityEnabled = !!on; envGravity.checked = !!on; },
  setDrag: (on) => { physics.dragEnabled = !!on; envDrag.checked = !!on; },
  addWaypoint: (x, y, z) => {
    waypoints.push(new THREE.Vector3(x, y, z));
    renderWaypoints();
    pathLine.update(waypoints);
  },
  clearWaypoints: () => {
    waypoints.length = 0;
    renderWaypoints();
    pathLine.update(waypoints);
  },
  runMission: () => {
    if (waypoints.length === 0) { Sound.err(); return; }
    mission.waypoints = waypoints.map(p => p.clone());
    mission.idx = 0;
    mission.holdTime = 0;
    setMode(FlightMode.MISSION);
  },
  reset: () => spawnDrone(new THREE.Vector2(physics.position.x, physics.position.z)),
};

const scriptOut = document.getElementById('script-output');
const scriptArea = document.getElementById('script-area');
const scriptRunner = new DroneScriptRunner(scriptApi, scriptOut);
document.getElementById('script-run')?.addEventListener('click', () => {
  scriptRunner.clearOutput();
  scriptRunner.run(scriptArea.value);
});
document.getElementById('script-stop')?.addEventListener('click', () => scriptRunner.stop());
document.getElementById('script-clear')?.addEventListener('click', () => scriptRunner.clearOutput());
document.getElementById('drone-script-example')?.addEventListener('change', (e) => {
  const v = e.target.value;
  if (v && DRONE_SCRIPT_EXAMPLES[v]) {
    scriptArea.value = DRONE_SCRIPT_EXAMPLES[v];
  }
});

spawnDrone(new THREE.Vector2(0, 0));
tick();
Loading.hide(400);

function setTarget(opts = {}) {
  if (typeof opts.x === 'number') target.x = opts.x;
  if (typeof opts.z === 'number') target.z = opts.z;
  if (typeof opts.altitude === 'number') target.y = opts.altitude;
  if (typeof opts.y === 'number') target.y = opts.y;
  controller.setTarget(target);
  if (typeof opts.yaw === 'number') controller.targetYaw = opts.yaw;

  if (typeof opts.pitch === 'number' || typeof opts.roll === 'number') {
    console.info('drone.setTarget: pitch/roll are stabilized outputs, ignored. Use drone.controller.maxTilt to change lean limits.');
  }
}

window.drone = {
  physics,
  controller,
  terrain,
  sentry,
  waypoints,
  setTarget,
  setWind: (x, z) => {
    physics.wind.set(x, 0, z);
    windX.value = x; windZ.value = z;
    windXv.textContent = x.toFixed(1); windZv.textContent = z.toFixed(1);
  },
  gust: (vx, vy, vz) => {
    if (vx === undefined) {
      const a = Math.random() * Math.PI * 2;
      physics.applyImpulse(new THREE.Vector3(Math.cos(a) * 3, (Math.random() - 0.3) * 1.5, Math.sin(a) * 3));
    } else {
      physics.applyImpulse(new THREE.Vector3(vx, vy ?? 0, vz ?? 0));
    }
  },
  setGravity: (on) => { physics.gravityEnabled = !!on; envGravity.checked = !!on; },
  setDrag: (on) => { physics.dragEnabled = !!on; envDrag.checked = !!on; },
  reset: () => spawnDrone(new THREE.Vector2(physics.position.x, physics.position.z)),
};
