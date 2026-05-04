// Drone simulator entry point. Wires together the scene, the quadrotor
// physics + cascaded PID, the OSM-imagery + Mapzen-elevation 3D terrain,
// the sentry easter-egg, and the UI panel (flight modes, PID tuning,
// address input, waypoint export).

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

// -------------------------------------------------------------------------
// Boot: scene, camera, renderer, lights.
// -------------------------------------------------------------------------

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
orbit.zoomSpeed = 2.4;        // faster scroll-wheel zoom
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

// -------------------------------------------------------------------------
// City scene, drone visual, sentry.
// -------------------------------------------------------------------------

const terrain = new City(scene);

const physics = new DronePhysics();
// Bare-ground only — building rooftops + walls go through collideFn so the
// drone doesn't get teleported up to a roof when it flies past a building.
physics.groundHeightFn = () => 0;
physics.collideFn = (pos, vel, r) => terrain.collide(pos, vel, r);
physics.collideRadius = 0.55;
const controller = new DroneController(physics);

// Spawn the drone above the terrain so it isn't buried in a hill.
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
// Place sentry on the terrain.
function reseatSentry() {
  const sx = sentry.group.position.x, sz = sentry.group.position.z;
  sentry.group.position.y = terrain.heightAt(sx, sz);
}

// -------------------------------------------------------------------------
// Drone-mounted camera (renders to the small canvas in the corner).
// -------------------------------------------------------------------------

// FPV camera. 90° vertical FOV gives an action-cam-like wide angle in FPV
// mode. Aspect is updated each frame to match whichever surface is rendering it.
const droneCam = new THREE.PerspectiveCamera(90, 320 / 200, 0.02, 4000);
const camCanvas = document.getElementById('cam-canvas');
const camRenderer = new THREE.WebGLRenderer({ antialias: true, canvas: camCanvas });
camRenderer.setPixelRatio(1);
camRenderer.setSize(320, 200, false);
camRenderer.outputColorSpace = THREE.SRGBColorSpace;

// ---- FPV toggle: swap which camera renders to the main viewport ---------
let fpvMode = false;
function toggleFPV() {
  fpvMode = !fpvMode;
  // Lock orbit while in FPV so mouse/scroll don't fight the drone view.
  orbit.enabled = !fpvMode;
  const label = document.querySelector('#cam-feed .label');
  if (label) label.textContent = fpvMode ? 'CHASE CAM' : 'DRONE CAM';
  const btn = document.getElementById('btn-fpv');
  if (btn) btn.classList.toggle('primary', fpvMode);
}

// -------------------------------------------------------------------------
// Flight modes + waypoint recording.
// -------------------------------------------------------------------------

const FlightMode = { HOVER: 'HOVER', MANUAL: 'MANUAL', MISSION: 'MISSION' };
let mode = FlightMode.HOVER;
const target = new THREE.Vector3(0, 1.5, 0);
controller.setTarget(target);

const waypoints = [];
let recording = false;
let recordTimer = 0;

const mission = { waypoints: [], idx: 0, holdTime: 0 };

// Dual-stick keyboard control (Mode 2 layout, similar to a real RC transmitter).
//
//   Left stick  (WASD):  W/S = throttle (climb/descend)
//                        A/D = yaw  (rotate left/right)
//   Right stick (arrows): Up/Down    = pitch (forward/back, body-relative)
//                         Left/Right = roll  (strafe left/right, body-relative)
//
// Inputs always nudge the position+yaw target — the inner PID then commands
// the motors to track. Active in any flight mode (MISSION will keep
// overwriting the target, so sticks don't fight a running mission).
const keys = new Set();
const STICK_KEYS = new Set([
  'w','a','s','d',
  'arrowup','arrowdown','arrowleft','arrowright',
  'v','g','f',
]);
window.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  const k = e.key.toLowerCase();
  if (STICK_KEYS.has(k)) e.preventDefault();   // stop arrow-keys from scrolling
  keys.add(k);
  if (k === 'g') sentry.toggle();
  if (k === 'v' || k === 'f') toggleFPV();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function applyManualInput(dt) {
  // Left stick.
  const throttle = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
  const yawIn    = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  // Right stick.
  const pitch = (keys.has('arrowup')    ? 1 : 0) - (keys.has('arrowdown')  ? 1 : 0);
  const roll  = (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft')  ? 1 : 0);

  if (!throttle && !yawIn && !pitch && !roll) return;

  const climbSpeed = 5.0;     // m/s
  const yawSpeed   = 1.8;     // rad/s
  const moveSpeed  = mode === FlightMode.MANUAL ? 8.0 : 6.0;

  if (throttle) {
    target.y += throttle * climbSpeed * dt;
    const minH = terrain.heightAt(target.x, target.z) + 0.5;
    if (target.y < minH) target.y = minH;
  }
  if (yawIn) {
    controller.targetYaw += yawIn * yawSpeed * dt;
  }
  if (pitch || roll) {
    // Body-relative motion. Body forward = (sin(yaw), 0, cos(yaw)),
    // body right = (cos(yaw), 0, -sin(yaw)).
    const yaw = controller.targetYaw;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    target.x += (pitch * sy + roll * cy) * moveSpeed * dt;
    target.z += (pitch * cy - roll * sy) * moveSpeed * dt;
  }
  controller.setTarget(target);
}

// Place-drone and click-to-set-target.
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
  // Iterative ground-intersection: the terrain has displacement, so a flat
  // y=0 raycast misses hills. We sample along the ray and find where it
  // crosses the terrain height function.
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
  // March along the ray from origin, looking for the first sample where the
  // ray's y dips below terrain.heightAt(x, z). Coarse → fine refinement.
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
      // Crossed: bisect between prevT and t.
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

// -------------------------------------------------------------------------
// UI wiring.
// -------------------------------------------------------------------------

Theme.apply();
const accentEl = document.getElementById('topbar-accent');
accentEl.value = Theme.load().accent;
accentEl.addEventListener('input', () => Theme.set({ accent: accentEl.value }));
document.getElementById('topbar-sound').addEventListener('change', (e) => Sound.setEnabled(e.target.checked));
document.addEventListener('click', (e) => { if (e.target?.tagName === 'BUTTON') Sound.click(); });

function setMode(m) {
  mode = m;
  controller.reset();   // clear PID integrals so mode switches don't kick
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

// Waypoints.
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

// FPV button (the V key is wired in the global keydown handler).
document.getElementById('btn-fpv').addEventListener('click', toggleFPV);

// PID tuning panel.
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

// Environment toggles + wind.
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
  // Inject a quick world-frame velocity impulse (~3 m/s in a random horizontal
  // direction, plus a small vertical kick) — instantly visible on the scope.
  const a = Math.random() * Math.PI * 2;
  physics.applyImpulse(new THREE.Vector3(Math.cos(a) * 3, (Math.random() - 0.3) * 1.5, Math.sin(a) * 3));
  Sound.beep();
});

// Telemetry scopes.
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

// -------------------------------------------------------------------------
// Path line.
// -------------------------------------------------------------------------

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

// -------------------------------------------------------------------------
// HUD updates.
// -------------------------------------------------------------------------

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

// -------------------------------------------------------------------------
// Mission stepper.
// -------------------------------------------------------------------------

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

// -------------------------------------------------------------------------
// Camera follow: when the user isn't actively dragging, smoothly chase the
// drone so it never drifts out of view. Uses a critically-damped low-pass.
// -------------------------------------------------------------------------

let lastUserInteract = 0;
['pointerdown', 'wheel'].forEach(ev => {
  renderer.domElement.addEventListener(ev, () => { lastUserInteract = performance.now(); });
});
function followCamera(dt) {
  if (sentry.equipped) return;
  // If the user has interacted in the last 1.5s, leave the camera alone so
  // they can frame their own shot without fighting the follow.
  const idle = performance.now() - lastUserInteract > 1500;
  if (!idle) return;
  const desired = physics.position.clone();
  // Smoothly drive orbit.target toward the drone.
  orbit.target.lerp(desired, Math.min(1, dt * 2.5));
}

// -------------------------------------------------------------------------
// Main loop.
// -------------------------------------------------------------------------

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

  // Sync mesh.
  droneMesh.group.position.copy(physics.position);
  droneMesh.group.quaternion.copy(physics.quat);
  droneMesh.spinProps(dt, physics.armed && !physics.wrecked ? Math.max(0.2, physics.collective) : 0);
  droneMesh.setStatus(physics.wrecked ? 'wrecked' : 'ok');

  // Motor hum tracks collective.
  const intensity = physics.armed && !physics.wrecked ? Math.min(1, physics.collective + 0.1) : 0;
  Sound.motor('drone', 95).setIntensity(intensity);

  // Recording.
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

  // Drone-mounted camera.
  const camOffset = new THREE.Vector3(0, 0.005, 0.115).applyQuaternion(physics.quat);
  droneCam.position.copy(physics.position).add(camOffset);
  const camFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(physics.quat);
  droneCam.lookAt(droneCam.position.clone().add(camFwd));

  // Crash sound.
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

  // Telemetry sampling + render.
  telemetryT += dt;
  const eul = physics.getEuler();
  const rad2deg = 180 / Math.PI;
  scopeAlt.push(telemetryT, [physics.position.y, target.y]);
  scopeRPY.push(telemetryT, [eul.roll * rad2deg, eul.pitch * rad2deg, eul.yaw * rad2deg]);
  scopeMotors.push(telemetryT, physics.omega.slice());
  scopeAlt.render();
  scopeRPY.render();
  scopeMotors.render();

  // Choose which camera renders to the main viewport vs. the corner preview.
  // Sentry mode wins; otherwise FPV mode swaps drone-cam and chase-cam.
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
  // Aspect-fit: the main renderer fills the viewport, the preview is fixed 320x200.
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

// -------------------------------------------------------------------------
// Boot: hide the loading overlay once terrain has had a moment to stream
// (we don't block on it — the drone can fly while elevation loads).
// -------------------------------------------------------------------------

// Drive renderer.setSize from the viewport's actual layout size (not just
// window resize) — fixes the case where the canvas was sized at boot before
// CSS layout settled, leaving the FPV view rendering at the wrong resolution
// and looking like it only fills part of the screen.
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

// First spawn at origin once the scene is up.
spawnDrone(new THREE.Vector2(0, 0));
tick();
Loading.hide(400);

// Public scripting API. Usage from the JS console:
//   drone.setTarget({ altitude: 4, yaw: 1.57 })
//   drone.setTarget({ x: 5, z: -3, altitude: 2 })
//   drone.setWind(2, 0)        // m/s in world X/Z
//   drone.gust()               // random horizontal kick
//   drone.setGravity(false)    // toggle gravity off
//   drone.reset()              // respawn drone in place
function setTarget(opts = {}) {
  if (typeof opts.x === 'number') target.x = opts.x;
  if (typeof opts.z === 'number') target.z = opts.z;
  if (typeof opts.altitude === 'number') target.y = opts.altitude;
  if (typeof opts.y === 'number') target.y = opts.y;
  controller.setTarget(target);
  if (typeof opts.yaw === 'number') controller.targetYaw = opts.yaw;
  // Pitch/roll are stabilized outputs of the position/velocity loops; we
  // accept them in the API for spec-completeness but log when ignored.
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
