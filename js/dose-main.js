import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildDoseMesh, DOSE_DIMS } from './dose-mesh.js';
import { ScaraArm } from './dose-arm.js';
import { DosePhysics } from './dose-physics.js';
import { buildHospitalEnvironment, buildFlatEnvironment, disposeEnvironment } from './dose-environment.js';

const stage = document.getElementById('stage');
const hudPose = document.getElementById('hud-pose');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
camera.position.set(3.5, 2.4, 4.0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);
controls.enableDamping = true;

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize', resize);

const handles = buildDoseMesh();
const robotRoot = handles.group;
scene.add(robotRoot);
robotRoot.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

const arm = new ScaraArm(handles);
const physics = new DosePhysics();

let env = null;
function loadEnvironment(name) {
  if (env) {
    disposeEnvironment(env, scene);
    env = null;
  }
  scene.clear();
  scene.add(robotRoot);
  env = name === 'flat' ? buildFlatEnvironment(scene) : buildHospitalEnvironment(scene);
  physics.setColliders(env.colliders);
  physics.reset(env.spawnPos.clone(), env.spawnHeading);
  arm.reset();
  document.getElementById('env-hospital').classList.toggle('primary', name !== 'flat');
  document.getElementById('env-flat').classList.toggle('primary', name === 'flat');
}
loadEnvironment('hospital');

document.getElementById('env-hospital').addEventListener('click', () => loadEnvironment('hospital'));
document.getElementById('env-flat').addEventListener('click', () => loadEnvironment('flat'));
document.getElementById('btn-reset').addEventListener('click', () => {
  if (!env) return;
  physics.reset(env.spawnPos.clone(), env.spawnHeading);
  arm.reset();
});

const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  keys.add(e.key.toLowerCase());
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

const ARM_YAW_RATE = 1.4;
const Z_RATE = 0.35;
const GRIP_RATE = 1.6;

function applyKeyboard(dt) {
  let lin = 0, ang = 0;
  if (keys.has('w')) lin += 1;
  if (keys.has('s')) lin -= 1;
  if (keys.has('a')) ang += 1;
  if (keys.has('d')) ang -= 1;
  physics.command(lin, ang);

  if (keys.has('q')) arm.targetQ1 += ARM_YAW_RATE * dt;
  if (keys.has('e')) arm.targetQ1 -= ARM_YAW_RATE * dt;
  if (keys.has('r')) arm.targetZ = Math.min(0, arm.targetZ + Z_RATE * dt);
  if (keys.has('f')) arm.targetZ = Math.max(-DOSE_DIMS.zRange, arm.targetZ - Z_RATE * dt);
  if (keys.has('z')) arm.targetGrip = Math.max(0, arm.targetGrip - GRIP_RATE * dt);
  if (keys.has('x')) arm.targetGrip = Math.min(1, arm.targetGrip + GRIP_RATE * dt);
}

const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 30);

  applyKeyboard(dt);
  physics.step(dt);
  arm.step(dt);

  robotRoot.position.x = physics.position.x;
  robotRoot.position.z = physics.position.z;
  robotRoot.rotation.y = physics.heading;
  handles.leftWheel.rotation.x = physics.wheelSpinL;
  handles.rightWheel.rotation.x = physics.wheelSpinR;

  hudPose.textContent =
    `x: ${physics.position.x.toFixed(2)}  z: ${physics.position.z.toFixed(2)}  yaw: ${physics.heading.toFixed(2)}`;

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
