/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║ RoboForge - DOSE Robot Simulator Main Module                ║
 * ║ Created by: Rishik Saravanan                                ║
 * ║ Birthday: May 25th                                          ║
 * ║ © 2024-2026. All rights reserved.                           ║
 * ║ Unauthorized copying, modification, or distribution         ║
 * ║ of this software is prohibited.                             ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildDoseMesh, DOSE_DIMS } from './dose-mesh.js';
import { RebotArm } from './dose-arm.js';
import { DosePhysics } from './dose-physics.js';
import { buildHospitalEnvironment, buildFlatEnvironment, disposeEnvironment } from './dose-environment.js';
import { Robot } from './robot.js';
import { MeshLibrary } from './meshLibrary.js';
import { Loading } from './loading.js';

// Green-and-black scheme for the RS arm, matching the main viewer.
const RS_COLORS = {
  link: 0x2ea043,
  revolute: 0x18191b,
  base: 0x131416,
  linkDark: 0x232427,
  bolt: 0x0e0f10,
};
// reBot RS ships folded; open it to a natural "ready" pose (J1..J6, radians).
const RS_READY_POSE = [0, 1.0, -1.4, 0.6, 0, 0];

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
  const world = arm.toolWorldPosition();
  recordFrames.push({
    t: recordTime,
    robot: {
      x: physics.position.x,
      z: physics.position.z,
      heading: physics.heading,
    },
    arm: arm.snapshot(),
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
  const LIFT_MAX = DOSE_DIMS.liftRange;
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
    const j = f.arm.joints.map(v => mapPWM(v, -Math.PI, Math.PI));
    const liftPwm = mapPWM(f.arm.lift ?? 0, 0, LIFT_MAX);
    const gripPwm = mapPWM(f.arm.grip, 0, 1);
    tableLines.push(`  { ${f.t.toFixed(3)}f, ${wheelL}, ${wheelR}, ${j[0]}, ${j[1]}, ${j[2]}, ${j[3]}, ${j[4]}, ${j[5]}, ${liftPwm}, ${gripPwm} },`);
  }

  return `// Auto-generated by RoboForge dose recorder.
// BLDC ESC + servo PWM playback for the dose mobile robot + reBot RS arm.
// All channels use the Servo lib (1000-2000us, 1500us neutral).
//
// Channels:
//   wheelL, wheelR       : drive BLDC ESCs (1500us = stop).
//   j1..j6               : RS arm joint servos (base yaw -> gripper roll).
//   lift                 : mast-lift BLDC (whole arm up/down on the mast).
//   grip                 : gripper servo (1000=open, 2000=closed).
#include <Servo.h>

const int PIN_WHEEL_L = 3;
const int PIN_WHEEL_R = 5;
const int PIN_J1   = 6;
const int PIN_J2   = 7;
const int PIN_J3   = 8;
const int PIN_J4   = 9;
const int PIN_J5   = 10;
const int PIN_J6   = 11;
const int PIN_LIFT = 12;
const int PIN_GRIP = 13;

Servo wheelL, wheelR, j1Servo, j2Servo, j3Servo, j4Servo, j5Servo, j6Servo, liftEsc, gripEsc;

struct Frame {
  float t;
  int wheelL, wheelR, j1, j2, j3, j4, j5, j6, lift, grip;
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
  j1Servo.writeMicroseconds(f.j1);
  j2Servo.writeMicroseconds(f.j2);
  j3Servo.writeMicroseconds(f.j3);
  j4Servo.writeMicroseconds(f.j4);
  j5Servo.writeMicroseconds(f.j5);
  j6Servo.writeMicroseconds(f.j6);
  liftEsc.writeMicroseconds(f.lift);
  gripEsc.writeMicroseconds(f.grip);
}

void setup() {
  wheelL.attach(PIN_WHEEL_L);
  wheelR.attach(PIN_WHEEL_R);
  j1Servo.attach(PIN_J1);
  j2Servo.attach(PIN_J2);
  j3Servo.attach(PIN_J3);
  j4Servo.attach(PIN_J4);
  j5Servo.attach(PIN_J5);
  j6Servo.attach(PIN_J6);
  liftEsc.attach(PIN_LIFT);
  gripEsc.attach(PIN_GRIP);

  if (TIME_SCALE > 1.0f) TIME_SCALE = 1.0f;
  if (TIME_SCALE < 0.05f) TIME_SCALE = 0.05f;

  Frame neutral = { 0, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500 };
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

  Frame neutral = { 0, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500 };
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
  arm.applyPose(frame.arm);
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
  const lerp = (x, y) => x + (y - x) * u;
  applyDoseFrame({
    t: playT,
    robot: {
      x: lerp(a.robot.x, b.robot.x),
      z: lerp(a.robot.z, b.robot.z),
      heading: lerp(a.robot.heading, b.robot.heading),
    },
    arm: {
      joints: a.arm.joints.map((v, i) => lerp(v, b.arm.joints[i] ?? v)),
      lift: lerp(a.arm.lift ?? 0, b.arm.lift ?? 0),
      grip: lerp(a.arm.grip, b.arm.grip),
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

const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  keys.add(e.key.toLowerCase());
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

// One key pair per RS joint (J1 base yaw .. J6 gripper roll).
const JOINT_KEYS = [
  { pos: 'q', neg: 'e' }, // J1 base yaw
  { pos: 'r', neg: 'f' }, // J2 shoulder pitch
  { pos: 't', neg: 'g' }, // J3 elbow pitch
  { pos: 'y', neg: 'h' }, // J4 wrist pitch
  { pos: 'u', neg: 'j' }, // J5 wrist yaw
  { pos: 'o', neg: 'l' }, // J6 gripper roll
];
const JOINT_RATE = 1.2;
const LIFT_RATE = 0.35;
const GRIP_RATE = 1.6;

function applyKeyboard(dt) {
  if (playing) return;

  let lin = 0, ang = 0;
  if (keys.has('w') || keys.has('arrowup')) lin += 1;
  if (keys.has('s') || keys.has('arrowdown')) lin -= 1;
  if (keys.has('a') || keys.has('arrowleft')) ang += 1;
  if (keys.has('d') || keys.has('arrowright')) ang -= 1;
  physics.command(lin, ang);

  JOINT_KEYS.forEach((k, i) => {
    if (keys.has(k.pos)) arm.nudgeJoint(i, JOINT_RATE * dt);
    if (keys.has(k.neg)) arm.nudgeJoint(i, -JOINT_RATE * dt);
  });
  if (keys.has('c')) arm.nudgeLift(LIFT_RATE * dt, DOSE_DIMS.liftRange);
  if (keys.has('v')) arm.nudgeLift(-LIFT_RATE * dt, DOSE_DIMS.liftRange);
  if (keys.has('z')) arm.setGripper(arm.targetGrip - GRIP_RATE * dt);
  if (keys.has('x')) arm.setGripper(arm.targetGrip + GRIP_RATE * dt);
}

/** Build the RS arm's 6 joints from the loaded manifest (mirrors main.js). */
function buildRSJoints(r) {
  const cardinal = v => {
    const ax = ['x', 'y', 'z'];
    let bi = 0;
    for (let i = 1; i < 3; i++) if (Math.abs(v[i]) > Math.abs(v[bi])) bi = i;
    return ax[bi];
  };
  for (const e of MeshLibrary.jointEntries('RS')) {
    r.addJoint({
      type: 'revolute',
      axis: Array.isArray(e.axis) ? cardinal(e.axis) : (e.jointAxis || 'y'),
      axisVec: Array.isArray(e.axis) ? e.axis : null,
      tipOffset: Array.isArray(e.tipOffset) ? e.tipOffset : null,
      linkLength: e.linkLength ?? 0.1,
      linkRadius: e.collisionRadius ?? 0.05,
      linkAxis: e.linkAxis || '+y',
      min: e.min ?? -Math.PI,
      max: e.max ?? Math.PI,
      meshId: e.id,
    });
  }
  for (const [k, v] of Object.entries(RS_COLORS)) r.setColor(k, v);
  if (RS_READY_POSE.length === r.joints.length) {
    RS_READY_POSE.forEach((v, i) => { r.joints[i].value = v; r._applyJointTransform(r.joints[i]); });
  }
  r.setGripperOpen?.(0);
}

let arm = null;
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

async function init() {
  Loading.show('Loading reBot RS arm…');
  try {
    await MeshLibrary.load('RS');
  } catch (err) {
    Loading.hide();
    console.warn('[RoboForge] RS arm load failed:', err);
    alert(`Could not load the RS arm CAD assets:\n${err.message}\n\nThe dose robot cannot run without it — reload the page to retry.`);
    return;
  }

  const rsRobot = new Robot(handles.liftSlide, { meshSet: 'RS' });
  rsRobot.rootGroup.position.set(0, 0.05, 0.03); // sit on top of the lift carriage
  buildRSJoints(rsRobot);
  arm = new RebotArm(rsRobot, handles);

  Loading.hide(150);

  loadEnvironment('hospital');
  initDoseRecordUI();

  document.getElementById('env-hospital').addEventListener('click', () => loadEnvironment('hospital'));
  document.getElementById('env-flat').addEventListener('click', () => loadEnvironment('flat'));
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (!env) return;
    physics.reset(env.spawnPos.clone(), env.spawnHeading);
    arm.reset();
  });

  tick();
}
init();
