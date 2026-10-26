
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║ RoboForge - Inverse Kinematics Solver                       ║
 * ║ Created by: Rishik Saravanan                                ║
 * ║ Birthday: May 25th                                          ║
 * ║ © 2024-2026. All rights reserved.                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import * as THREE from 'three';
import { AXIS_VECTOR } from './robot.js';

const _tmpV1 = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpV3 = new THREE.Vector3();
const _tmpQ = new THREE.Quaternion();
const _tmpM = new THREE.Matrix4();
const _axisWorld = new THREE.Vector3();

export function solveIK(robot, target, options = {}) {
  const maxIter = options.maxIter ?? 20;
  const tol = options.tolerance ?? 0.005;
  if (robot.joints.length === 0) return { converged: false, error: Infinity, iterations: 0 };

  if (robot.floorClearance && target.y < robot.floorY + 0.02) {
    target = target.clone();
    target.y = robot.floorY + 0.02;
  }

  const eeWorld = new THREE.Vector3();
  const snap = robot._snapshotJointValues();

  for (let iter = 0; iter < maxIter; iter++) {
    robot.getEndEffectorWorldPosition(eeWorld);
    const err = eeWorld.distanceTo(target);
    if (err < tol) return { converged: true, error: err, iterations: iter };

    const iterSnap = robot._snapshotJointValues();
    for (let i = robot.joints.length - 1; i >= 0; i--) {
      const j = robot.joints[i];
      j.group.updateWorldMatrix(true, true);

      if (j.type === 'revolute') {
        _solveRevolute(j, robot, target);
      } else {
        _solvePrismatic(j, robot, target);
      }
    }

    if (robot._hasViolation()) {
      robot._restoreJointValues(iterSnap);
      robot.getEndEffectorWorldPosition(eeWorld);
      const err2 = eeWorld.distanceTo(target);
      return { converged: false, error: err2, iterations: iter, blocked: true };
    }
  }

  robot.getEndEffectorWorldPosition(eeWorld);
  const err = eeWorld.distanceTo(target);
  if (robot._hasViolation()) {
    robot._restoreJointValues(snap);
    robot.getEndEffectorWorldPosition(eeWorld);
    return { converged: false, error: eeWorld.distanceTo(target), iterations: maxIter, blocked: true };
  }
  return { converged: err < tol, error: err, iterations: maxIter };
}

function _solveRevolute(j, robot, target) {

  const jointPos = _tmpV1.setFromMatrixPosition(j.articulator.matrixWorld);

  const eePos = robot.getEndEffectorWorldPosition(_tmpV2);

  const localAxis = AXIS_VECTOR[j.axis];
  _axisWorld.copy(localAxis).transformDirection(j.group.matrixWorld);

const toEE = _tmpV3.copy(eePos).sub(jointPos);
  const toTarget = new THREE.Vector3().subVectors(target, jointPos);

const eeProj = toEE.clone().projectOnPlane(_axisWorld);
  const targetProj = toTarget.clone().projectOnPlane(_axisWorld);
  if (eeProj.lengthSq() < 1e-9 || targetProj.lengthSq() < 1e-9) return;
  eeProj.normalize();
  targetProj.normalize();

  let cosA = THREE.MathUtils.clamp(eeProj.dot(targetProj), -1, 1);
  let angle = Math.acos(cosA);

  const cross = new THREE.Vector3().crossVectors(eeProj, targetProj);
  if (cross.dot(_axisWorld) < 0) angle = -angle;

  const newValue = THREE.MathUtils.clamp(j.value + angle, j.min, j.max);
  if (newValue !== j.value) {
    j.value = newValue;
    robot._applyJointTransform(j);
  }
}

function _solvePrismatic(j, robot, target) {

  const eePos = robot.getEndEffectorWorldPosition(_tmpV1);
  const localAxis = AXIS_VECTOR[j.axis];

  _axisWorld.copy(localAxis).transformDirection(j.group.matrixWorld);
  const error = _tmpV2.copy(target).sub(eePos);
  const delta = error.dot(_axisWorld);
  const newValue = THREE.MathUtils.clamp(j.value + delta, j.min, j.max);
  if (newValue !== j.value) {
    j.value = newValue;
    robot._applyJointTransform(j);
  }
}

/** True if every joint value in a/b is within `eps` radians/metres of the other. */
function _posesClose(a, b, eps = 0.05) {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > eps) return false;
  }
  return true;
}

/**
 * Solve IK like solveIK(), but guard against the arm folding into itself.
 * CCD is a local solver — it only ever finds the one configuration reachable
 * by nudging joints from wherever they currently sit. If that configuration
 * self-collides (or sinks through the floor), re-seed the joints to a
 * different starting combination (zero pose, mirrored pose, several random
 * poses) and re-run CCD from there, keeping every seed that reaches the
 * target cleanly. Returns the best clean result plus every other clean
 * alternative found, so the caller can cycle between them.
 */
export function solveIKAvoidingCollisions(robot, target, options = {}) {
  const maxIter = options.maxIter ?? 20;
  const tol = options.tolerance ?? 0.005;
  const restarts = options.restarts ?? 8;
  const n = robot.joints.length;
  const startPose = robot._snapshotJointValues();
  if (n === 0) return { converged: false, error: Infinity, iterations: 0, alternates: [] };
  if (!robot.selfCollision) {
    // Nothing to avoid — just solve normally from wherever the arm is.
    const r = solveIK(robot, target, { maxIter, tolerance: tol });
    return { ...r, alternates: [] };
  }

  const applyPose = (pose) => {
    for (let i = 0; i < n; i++) {
      const j = robot.joints[i];
      j.value = THREE.MathUtils.clamp(pose[i], j.min, j.max);
      robot._applyJointTransform(j);
    }
  };

  // Candidate starting combinations: as-is, all-zero, mirrored, then a spread
  // of random poses across each joint's full range.
  const seeds = [
    startPose.slice(),
    new Array(n).fill(0),
    startPose.map(v => -v),
  ];
  for (let k = 0; k < restarts; k++) {
    seeds.push(robot.joints.map(j => THREE.MathUtils.lerp(j.min, j.max, Math.random())));
  }

  const attempts = [];
  for (const seed of seeds) {
    applyPose(seed);
    const r = solveIK(robot, target, { maxIter, tolerance: tol });
    const pose = robot._snapshotJointValues();
    const collides = robot.selfCollision && robot.checkSelfCollision();
    attempts.push({ pose, error: r.error, converged: r.converged, collides });
  }

  const clean = attempts
    .filter(a => a.converged && !a.collides)
    .sort((a, b) => a.error - b.error);
  const alternates = [];
  for (const a of clean) {
    if (!alternates.some(b => _posesClose(a.pose, b.pose))) alternates.push(a);
  }

  if (alternates.length) {
    applyPose(alternates[0].pose);
    const usedAlternateSeed = !_posesClose(alternates[0].pose, startPose);
    return {
      converged: true, error: alternates[0].error, blocked: false,
      selfCollisionAvoided: usedAlternateSeed && attempts[0].collides,
      alternates: alternates.map(a => a.pose),
    };
  }

  // Nothing found a clean path to the target from any seed — put the arm
  // back where it started and report the same way solveIK would.
  applyPose(startPose);
  const fallback = solveIK(robot, target, { maxIter, tolerance: tol });
  return { ...fallback, alternates: [] };
}

export class IKTracker {
  constructor(robot) {
    this.robot = robot;
    this.target = new THREE.Vector3();
    this.active = false;
    this.maxIter = 8;
    this.tolerance = 0.005;
  }
  start() { this.active = true; }
  stop() { this.active = false; }
  update() {
    if (!this.active) return;
    solveIK(this.robot, this.target, { maxIter: this.maxIter, tolerance: this.tolerance });
  }
}
