

import * as THREE from 'three';
import { DOSE_DIMS } from './dose-mesh.js';

export class ScaraArm {
  constructor(meshHandles) {
    this.handles = meshHandles;
    this.q1 = 0;
    this.q2 = 0;
    this.z  = 0;
    this.gripper = 0;

    this.targetQ1 = 0;
    this.targetQ2 = 0;
    this.targetZ  = 0;
    this.targetGrip = 0;

    this.q1Speed = 1.5;
    this.q2Speed = 1.8;
    this.zSpeed  = 0.4;
    this.gripSpeed = 4.0;

    this.elbowUp = true;

    this.attached = null;
  }

  reset() {
    this.q1 = this.q2 = this.z = this.gripper = 0;
    this.targetQ1 = this.targetQ2 = this.targetZ = this.targetGrip = 0;
    this.attached = null;
  }

  ikLocal(x, y, z) {
    const L1 = DOSE_DIMS.L1, L2 = DOSE_DIMS.L2;
    const r2 = x * x + y * y;
    const r  = Math.sqrt(r2);
    const reachMax = L1 + L2 - 1e-3;
    const reachMin = Math.abs(L1 - L2) + 1e-3;
    const rClamped = THREE.MathUtils.clamp(r, reachMin, reachMax);

    const sx = rClamped > 1e-6 ? x * (rClamped / r) : x;
    const sy = rClamped > 1e-6 ? y * (rClamped / r) : y;

    let cos2 = (rClamped * rClamped - L1 * L1 - L2 * L2) / (2 * L1 * L2);
    cos2 = THREE.MathUtils.clamp(cos2, -1, 1);
    const sign = this.elbowUp ? +1 : -1;
    const q2 = sign * Math.acos(cos2);
    const q1 = Math.atan2(sy, sx) - Math.atan2(L2 * Math.sin(q2), L1 + L2 * Math.cos(q2));

    const zClamped = THREE.MathUtils.clamp(z, -DOSE_DIMS.zRange, 0);
    return { q1, q2, z: zClamped };
  }

  setIKTarget(localX, localY, localZ) {
    const sol = this.ikLocal(localX, localY, localZ);
    this.targetQ1 = sol.q1;
    this.targetQ2 = sol.q2;
    this.targetZ  = sol.z;
    return sol;
  }

  setGripper(open01) {
    this.targetGrip = THREE.MathUtils.clamp(open01, 0, 1);
  }

  toolLocalPose() {
    const L1 = DOSE_DIMS.L1, L2 = DOSE_DIMS.L2;
    const x = L1 * Math.cos(this.q1) + L2 * Math.cos(this.q1 + this.q2);
    const y = L1 * Math.sin(this.q1) + L2 * Math.sin(this.q1 + this.q2);
    return { x, y, z: this.z };
  }

  step(dt) {
    const stepTo = (cur, tgt, speed) => {
      const d = tgt - cur;
      const m = speed * dt;
      if (Math.abs(d) <= m) return tgt;
      return cur + Math.sign(d) * m;
    };
    this.q1 = stepTo(this.q1, this.targetQ1, this.q1Speed);
    this.q2 = stepTo(this.q2, this.targetQ2, this.q2Speed);
    this.z  = stepTo(this.z,  this.targetZ,  this.zSpeed);
    this.gripper = stepTo(this.gripper, this.targetGrip, this.gripSpeed);

    this.handles.armYaw.rotation.y = -this.q1;
    this.handles.elbow.rotation.y = -this.q2;
    this.handles.zSlide.position.y = this.z;

    const open = 0.012 + this.gripper * 0.022;
    this.handles.fingerL.position.x = -open;
    this.handles.fingerR.position.x = +open;
  }

  isAtTarget(tol = 0.04) {
    return Math.abs(this.q1 - this.targetQ1) < tol &&
           Math.abs(this.q2 - this.targetQ2) < tol &&
           Math.abs(this.z  - this.targetZ ) < 0.01;
  }

  toolWorldPosition(robotPos, robotHeading) {
    const D = DOSE_DIMS;
    const local = this.toolLocalPose();
    const shoulderY = D.wheelRadius ?? 0.115;
    const baseTopY = (D.wheelR + D.baseH);
    const shoulderWorldY = baseTopY + D.shoulderHeight;
    const shoulderLocalZ = -D.baseD / 2 + D.mastW / 2 + 0.02;

    const cosH = Math.cos(robotHeading);
    const sinH = Math.sin(robotHeading);
    const lx = local.x, lz = -shoulderLocalZ - 0.0;

    const armX = local.x;
    const armZ = -shoulderLocalZ + 0;

    const px = robotPos.x + (armX) * sinH + 0;
    const pz = robotPos.z + (armX) * cosH + 0;
    const py = shoulderWorldY + local.z - 0.10;

    const out = new THREE.Vector3();
    this.handles.tool.getWorldPosition(out);
    out.y -= 0.10;
    return out;
  }
}
