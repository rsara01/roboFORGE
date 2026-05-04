// Static-load joint torque estimator.
//
// For each joint i we compute the magnitude of moment that the joint actuator
// must resist to hold the current pose against gravity. We sum contributions
// from every link i' >= i (its center of mass), every end effector tip, and
// every block currently attached to an end effector. For revolute joints the
// torque is the projection of (r × F) onto the joint's world axis. For
// prismatic joints we report the axial force component instead (also useful
// to know what the actuator has to support along the slide direction).

import * as THREE from 'three';
import { AXIS_VECTOR } from './robot.js';

const G = 9.81;

// Kg per metre of cylinder length, used to estimate link mass from geometry.
// Roughly steel-aluminium hybrid at the modelled radii.
const LINK_DENSITY_PER_M = 1.2;
// Per-EE mass estimate in kg (rough, but good enough to feel the load).
const EE_MASS = 0.25;

function massOfLink(j) {
  return Math.max(0.05, LINK_DENSITY_PER_M * j.link.length * (1 + 4 * j.link.radius));
}

function worldOf(obj, dst = new THREE.Vector3()) {
  obj.updateWorldMatrix(true, false);
  return dst.setFromMatrixPosition(obj.matrixWorld);
}

// Returns Array<{ jointIndex, name, type, value, axis, torqueNm, axialN }>.
// torqueNm is the static gravitational torque about the joint axis (revolute),
// axialN is the gravitational force projected on the joint axis (prismatic).
export function computeJointTorques(robot, physics) {
  const out = [];
  if (!robot?.joints?.length) return out;

  // Pre-compute world COM and weight (N) for each gravity load: links, EEs,
  // and held blocks. Each load belongs to a "from-joint-onward" subtree
  // because the chain is serial.
  const loads = []; // { idx, com: Vec3, weightN: number }
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  for (let i = 0; i < robot.joints.length; i++) {
    const j = robot.joints[i];
    // Link COM = midpoint between articulator origin and tip.
    const a = worldOf(j.articulator, new THREE.Vector3());
    const b = worldOf(j.tip, new THREE.Vector3());
    const com = a.clone().lerp(b, 0.5);
    loads.push({ idx: i, com, weightN: massOfLink(j) * G });
  }

  // EE loads: each EE is "after" the last joint (or the base if there are
  // no joints). For a serial chain that means it loads every joint.
  for (const ee of robot.endEffectors || []) {
    const com = worldOf(ee.tip, new THREE.Vector3());
    loads.push({ idx: robot.joints.length, com, weightN: EE_MASS * G });
  }

  // Held blocks attached to any EE tip.
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

    // World-space joint axis (housing rotation, then chain transforms).
    const localAxis = AXIS_VECTOR[j.axis] || AXIS_VECTOR.y;
    const axisWorld = localAxis.clone().transformDirection(j.group.matrixWorld).normalize();

    let torque = 0;  // N·m about axis (revolute)
    let axial  = 0;  // N along axis (prismatic)

    for (const ld of loads) {
      if (ld.idx < i) continue;            // load is BEFORE this joint, skip
      const r = tmp.subVectors(ld.com, jointPos);
      const f = tmp2.set(0, -ld.weightN, 0);
      if (j.type === 'revolute') {
        // tau = (r × F) · axis
        const cx = r.y * f.z - r.z * f.y;
        const cy = r.z * f.x - r.x * f.z;
        const cz = r.x * f.y - r.y * f.x;
        torque += cx * axisWorld.x + cy * axisWorld.y + cz * axisWorld.z;
      } else {
        // axial force = F · axis (negative means pulled along -axis)
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
