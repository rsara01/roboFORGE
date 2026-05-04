

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
