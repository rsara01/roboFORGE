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
let recording = false;
let recordTime = 0;
let recordFrames = [];
let timeScale = 1.0;

let playing = false;
let playT = 0;
let playIdx = 0;

function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function clampTimeScale(value) {
  return Math.min(1.0, Math.max(0.1, value));
}

function updateDoseScaleUI() {
  const scale = clampTimeScale(parseFloat(document.getElementById('dose-time-scale').value) || 1.0);
  timeScale = scale;
  document.getElementById('dose-scale-value').textContent = `${scale.toFixed(2)}x`;
  document.getElementById('dose-time-scale').value = scale;
}

function setDoseRecordState(active) {
  recording = active;
  document.getElementById('btn-record-dose').disabled = active;
  document.getElementById('btn-stop-dose').disabled = !active;
}

function startDoseRecording() {
  recordTime = 0;
  recordFrames = [];
  setDoseRecordState(true);
}

function stopDoseRecording() {
  setDoseRecordState(false);
}

function pushDoseFrame(dt) {
  if (!recording) return;
  recordTime += dt;
  const local = arm.toolLocalPose();
  const world = arm.toolWorldPosition(physics.position, physics.heading);
  recordFrames.push({
    t: recordTime,
    robot: {
      x: physics.position.x,
      z: physics.position.z,
      heading: physics.heading,
    },
    arm: {
      x: local.x,
      y: local.y,
      z: local.z,
      q1: arm.q1,
      q2: arm.q2,
      lift: arm.lift,
      grip: arm.gripper,
    },
    toolWorld: [world.x, world.y, world.z],
  });
}

function exportDoseJSON() {
  if (!recordFrames.length) {
    alert('No motion recorded yet. Press Record to capture a session first.');
    return;
  }
  const payload = {
    created: new Date().toISOString(),
    timeScale,
    frameCount: recordFrames.length,
    frames: recordFrames.map((frame) => ({
      t: frame.t * timeScale,
      robot: frame.robot,
      arm: frame.arm,
      toolWorld: frame.toolWorld,
    })),
  };
  downloadText('dose_motion.json', JSON.stringify(payload, null, 2), 'application/json');
}

function exportDoseArduino() {
  if (!recordFrames.length) {
    alert('No motion recorded yet. Press Record to capture a session first.');
    return;
  }
  const code = buildDoseArduino(recordFrames, timeScale);
  downloadText('dose_motion.ino', code, 'text/plain');
}

function buildDoseArduino(frames, scale) {
  if (!frames.length) return '// no frames\n';
  const Q_MIN = -Math.PI, Q_MAX = Math.PI;
  const LIFT_MAX = DOSE_DIMS.liftRange;
  const WRISTZ_MAX = DOSE_DIMS.zRange;
  const MAX_FWD = 1.6;
  const WHEELBASE_HALF = 0.275;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mapPWM = (val, lo, hi) => {
    if (hi === lo) return 1500;
    const u = clamp((val - lo) / (hi - lo), 0, 1);
    return Math.round(1000 + u * 1000);
  };

  const tableLines = [];
  let prev = frames[0];
  for (const f of frames) {
    const dxLocal = (f.robot.x - prev.robot.x) * Math.sin(f.robot.heading)
                  + (f.robot.z - prev.robot.z) * Math.cos(f.robot.heading);
    const dt = Math.max(1e-3, f.t - prev.t);
    const fwd = dxLocal / dt;
    const yaw = (f.robot.heading - prev.robot.heading) / dt;
    prev = f;

    const vL = clamp(fwd - yaw * WHEELBASE_HALF, -MAX_FWD, MAX_FWD) / MAX_FWD;
    const vR = clamp(fwd + yaw * WHEELBASE_HALF, -MAX_FWD, MAX_FWD) / MAX_FWD;
    const wheelL = 1500 + Math.round(vL * 400);
    const wheelR = 1500 + Math.round(vR * 400);
    const q1pwm = mapPWM(f.arm.q1, Q_MIN, Q_MAX);
    const q2pwm = mapPWM(f.arm.q2, Q_MIN, Q_MAX);
    const liftPwm = mapPWM(f.arm.lift ?? 0, 0, LIFT_MAX);
    const wristPwm = mapPWM(f.arm.z, -WRISTZ_MAX, 0);
    const gripPwm = mapPWM(f.arm.grip, 0, 1);
    tableLines.push(`  { ${f.t.toFixed(3)}f, ${wheelL}, ${wheelR}, ${q1pwm}, ${q2pwm}, ${liftPwm}, ${wristPwm}, ${gripPwm} },`);
  }

  return `// Auto-generated by RoboForge dose recorder.
// BLDC ESC + servo PWM playback for the dose mobile robot.
// All channels use the Servo lib (1000-2000us, 1500us neutral).
//
// Channels:
//   wheelL, wheelR : drive BLDC ESCs (1500us = stop).
//   q1, q2         : shoulder yaw + elbow yaw BLDC servos.
//   lift           : mast-lift BLDC.
//   wristZ         : wrist Z BLDC.
//   grip           : gripper BLDC (1000=open, 2000=closed).
#include <Servo.h>

const int PIN_WHEEL_L = 3;
const int PIN_WHEEL_R = 5;
const int PIN_Q1      = 6;
const int PIN_Q2      = 9;
const int PIN_LIFT    = 10;
const int PIN_WRISTZ  = 11;
const int PIN_GRIP    = 12;

Servo wheelL, wheelR, q1Esc, q2Esc, liftEsc, wristEsc, gripEsc;

struct Frame {
  float t;
  int wheelL, wheelR;
  int q1, q2, lift, wristZ, grip;
};

const Frame TRAJ[] = {
${tableLines.join('\n')}
};
const int N_FRAMES = sizeof(TRAJ) / sizeof(TRAJ[0]);

// Playback time scale: 1.0 = recorded speed, < 1.0 = slower. Cannot exceed 1.0.
float TIME_SCALE = ${scale.toFixed(2)}f;

void writeFrame(const Frame& f) {
  wheelL.writeMicroseconds(f.wheelL);
  wheelR.writeMicroseconds(f.wheelR);
  q1Esc.writeMicroseconds(f.q1);
  q2Esc.writeMicroseconds(f.q2);
  liftEsc.writeMicroseconds(f.lift);
  wristEsc.writeMicroseconds(f.wristZ);
  gripEsc.writeMicroseconds(f.grip);
}

void setup() {
  wheelL.attach(PIN_WHEEL_L);
  wheelR.attach(PIN_WHEEL_R);
  q1Esc.attach(PIN_Q1);
  q2Esc.attach(PIN_Q2);
  liftEsc.attach(PIN_LIFT);
  wristEsc.attach(PIN_WRISTZ);
  gripEsc.attach(PIN_GRIP);

  if (TIME_SCALE > 1.0f) TIME_SCALE = 1.0f;
  if (TIME_SCALE < 0.05f) TIME_SCALE = 0.05f;

  Frame neutral = { 0, 1500, 1500, 1500, 1500, 1500, 1500, 1500 };
  writeFrame(neutral);
  delay(2000);
}

void loop() {
  for (int i = 0; i < N_FRAMES; i++) {
    writeFrame(TRAJ[i]);
    if (i + 1 < N_FRAMES) {
      float dt = (TRAJ[i + 1].t - TRAJ[i].t) / TIME_SCALE;
      delay((unsigned long)(dt * 1000.0f));
    }
  }

  Frame neutral = { 0, 1500, 1500, 1500, 1500, 1500, 1500, 1500 };
  writeFrame(neutral);
  while (true) { delay(1000); }
}
`;
}

function startDosePlayback() {
  if (!recordFrames.length || playing) return;
  if (recording) stopDoseRecording();
  playing = true;
  playT = 0;
  playIdx = 0;
  document.getElementById('btn-play-dose').disabled = true;
  document.getElementById('btn-stop-play-dose').disabled = false;
}

function stopDosePlayback() {
  if (!playing) return;
  playing = false;
  document.getElementById('btn-play-dose').disabled = false;
  document.getElementById('btn-stop-play-dose').disabled = true;
}

function applyDoseFrame(frame) {
  physics.position.x = frame.robot.x;
  physics.position.z = frame.robot.z;
  physics.heading = frame.robot.heading;
  physics.linVel = 0; physics.angVel = 0;
  arm.q1 = arm.targetQ1 = frame.arm.q1;
  arm.q2 = arm.targetQ2 = frame.arm.q2;
  arm.lift = arm.targetLift = frame.arm.lift ?? 0;
  arm.z = arm.targetZ = frame.arm.z;
  arm.gripper = arm.targetGrip = frame.arm.grip;
  const pose = arm.toolLocalPose();
  arm.targetX = pose.x;
  arm.targetY = pose.y;
}

function stepDosePlayback(dt) {
  if (!playing || !recordFrames.length) return;
  playT += dt * timeScale;
  while (playIdx < recordFrames.length - 1 && recordFrames[playIdx + 1].t <= playT) {
    playIdx++;
  }
  const a = recordFrames[playIdx];
  const b = recordFrames[Math.min(playIdx + 1, recordFrames.length - 1)];
  let u = 0;
  if (b.t > a.t) u = (playT - a.t) / (b.t - a.t);
  u = Math.max(0, Math.min(1, u));
  applyDoseFrame({
    t: playT,
    robot: {
      x: a.robot.x + (b.robot.x - a.robot.x) * u,
      z: a.robot.z + (b.robot.z - a.robot.z) * u,
      heading: a.robot.heading + (b.robot.heading - a.robot.heading) * u,
    },
    arm: {
      q1: a.arm.q1 + (b.arm.q1 - a.arm.q1) * u,
      q2: a.arm.q2 + (b.arm.q2 - a.arm.q2) * u,
      lift: (a.arm.lift ?? 0) + ((b.arm.lift ?? 0) - (a.arm.lift ?? 0)) * u,
      z: a.arm.z + (b.arm.z - a.arm.z) * u,
      grip: a.arm.grip + (b.arm.grip - a.arm.grip) * u,
    },
  });
  if (playT >= recordFrames[recordFrames.length - 1].t) stopDosePlayback();
}

function initDoseRecordUI() {
  updateDoseScaleUI();
  document.getElementById('dose-time-scale').addEventListener('input', updateDoseScaleUI);
  document.getElementById('btn-record-dose').addEventListener('click', () => startDoseRecording());
  document.getElementById('btn-stop-dose').addEventListener('click', () => stopDoseRecording());
  document.getElementById('btn-export-dose-json').addEventListener('click', () => exportDoseJSON());
  document.getElementById('btn-export-dose-arduino').addEventListener('click', () => exportDoseArduino());
  const playBtn = document.getElementById('btn-play-dose');
  const stopPlayBtn = document.getElementById('btn-stop-play-dose');
  if (playBtn) playBtn.addEventListener('click', () => startDosePlayback());
  if (stopPlayBtn) stopPlayBtn.addEventListener('click', () => stopDosePlayback());
  document.getElementById('btn-stop-dose').disabled = true;
  if (stopPlayBtn) stopPlayBtn.disabled = true;
}

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
initDoseRecordUI();

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
const ARM_MOVE_RATE = 0.35;
const Z_RATE = 0.35;
const LIFT_RATE = 0.35;
const GRIP_RATE = 1.6;

function applyKeyboard(dt) {
  if (playing) return;

  let lin = 0, ang = 0;
  if (keys.has('arrowup')) lin += 1;
  if (keys.has('arrowdown')) lin -= 1;
  if (keys.has('arrowleft')) ang += 1;
  if (keys.has('arrowright')) ang -= 1;
  physics.command(lin, ang);

  let localX = arm.targetX ?? arm.toolLocalPose().x;
  let localY = arm.targetY ?? arm.toolLocalPose().y;
  if (keys.has('w')) localY += ARM_MOVE_RATE * dt;
  if (keys.has('s')) localY -= ARM_MOVE_RATE * dt;
  if (keys.has('a')) localX -= ARM_MOVE_RATE * dt;
  if (keys.has('d')) localX += ARM_MOVE_RATE * dt;
  arm.setIKTarget(localX, localY, arm.targetZ);
  arm.targetX = localX;
  arm.targetY = localY;

  if (keys.has('q')) arm.targetQ1 += ARM_YAW_RATE * dt;
  if (keys.has('e')) arm.targetQ1 -= ARM_YAW_RATE * dt;
  if (keys.has('t')) arm.targetLift = Math.min(DOSE_DIMS.liftRange, arm.targetLift + LIFT_RATE * dt);
  if (keys.has('g')) arm.targetLift = Math.max(0, arm.targetLift - LIFT_RATE * dt);
  if (keys.has('r')) arm.targetZ = Math.min(0, arm.targetZ + Z_RATE * dt);
  if (keys.has('f')) arm.targetZ = Math.max(-DOSE_DIMS.zRange, arm.targetZ - Z_RATE * dt);
  if (keys.has('z')) arm.targetGrip = Math.max(0, arm.targetGrip - GRIP_RATE * dt);
  if (keys.has('x')) arm.targetGrip = Math.min(1, arm.targetGrip + GRIP_RATE * dt);
}

const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 30);

  if (playing) {
    stepDosePlayback(dt);
  } else {
    applyKeyboard(dt);
    physics.step(dt);
  }
  arm.step(dt);
  if (recording && !playing) pushDoseFrame(dt);

  robotRoot.position.x = physics.position.x;
  robotRoot.position.z = physics.position.z;
  robotRoot.rotation.y = physics.heading;
  handles.leftWheel.rotation.x = physics.wheelSpinL;
  handles.rightWheel.rotation.x = physics.wheelSpinR;

  hudPose.textContent =
    `x: ${physics.position.x.toFixed(2)}  z: ${physics.position.z.toFixed(2)}  yaw: ${physics.heading.toFixed(2)}  lift: ${arm.lift.toFixed(2)}`
    + (recording ? '  · REC' : '')
    + (playing ? '  · PLAY' : '');

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
