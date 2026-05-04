

import * as THREE from 'three';
import { AXIS_VECTOR } from './robot.js';

const G = 9.81;

const LINK_DENSITY_PER_M = 1.2;

const EE_MASS = 0.25;

function massOfLink(j) {
  return Math.max(0.05, LINK_DENSITY_PER_M * j.link.length * (1 + 4 * j.link.radius));
}

function worldOf(obj, dst = new THREE.Vector3()) {
  obj.updateWorldMatrix(true, false);
  return dst.setFromMatrixPosition(obj.matrixWorld);
}

export function computeJointTorques(robot, physics) {
  const out = [];
  if (!robot?.joints?.length) return out;

  const loads = [];
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  for (let i = 0; i < robot.joints.length; i++) {
    const j = robot.joints[i];

    const a = worldOf(j.articulator, new THREE.Vector3());
    const b = worldOf(j.tip, new THREE.Vector3());
    const com = a.clone().lerp(b, 0.5);
    loads.push({ idx: i, com, weightN: massOfLink(j) * G });
  }

  for (const ee of robot.endEffectors || []) {
    const com = worldOf(ee.tip, new THREE.Vector3());
    loads.push({ idx: robot.joints.length, com, weightN: EE_MASS * G });
  }

  if (physics?.bodies?.length) {
    for (const body of physics.bodies) {
      if (!body.attachedTo) continue;
      const com = worldOf(body.mesh, new THREE.Vector3());
      loads.push({ idx: robot.joints.length, com, weightN: (body.mass ?? 0.05) * G });
    }
  }

  for (let i = 0; i < robot.joints.length; i++) {
    const j = robot.joints[i];
    const jointPos = worldOf(j.articulator, new THREE.Vector3());

    const localAxis = AXIS_VECTOR[j.axis] || AXIS_VECTOR.y;
    const axisWorld = localAxis.clone().transformDirection(j.group.matrixWorld).normalize();

    let torque = 0;
    let axial  = 0;

    for (const ld of loads) {
      if (ld.idx < i) continue;
      const r = tmp.subVectors(ld.com, jointPos);
      const f = tmp2.set(0, -ld.weightN, 0);
      if (j.type === 'revolute') {

        const cx = r.y * f.z - r.z * f.y;
        const cy = r.z * f.x - r.x * f.z;
        const cz = r.x * f.y - r.y * f.x;
        torque += cx * axisWorld.x + cy * axisWorld.y + cz * axisWorld.z;
      } else {

        axial += f.x * axisWorld.x + f.y * axisWorld.y + f.z * axisWorld.z;
      }
    }

    out.push({
      jointIndex: i,
      name: j.name,
      type: j.type,
      axis: j.axis,
      value: j.value,
      torqueNm: torque,
      axialN: axial,
    });
  }
  return out;
}
