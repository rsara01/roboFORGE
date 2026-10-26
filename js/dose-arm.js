
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║ RoboForge - DOSE Robot Arm Controller                        ║
 * ║ Created by: Rishik Saravanan                                ║
 * ║ Birthday: May 25th                                          ║
 * ║ © 2024-2026. All rights reserved.                           ║
 * ║ Unauthorized copying, modification, or distribution         ║
 * ║ of this software is prohibited.                             ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import * as THREE from 'three';

/**
 * Drives a reBot RS arm (a js/robot.js Robot instance, built with meshSet
 * 'RS' and mounted onto the dose mobile base's lift carriage) the same way
 * the old 2-link SCARA arm was driven: per-DOF targets that get approached
 * at a fixed speed each frame, so keyboard input and recorded playback both
 * move smoothly instead of snapping.
 */
export class RebotArm {
  constructor(robot, handles) {
    this.robot = robot;
    this.handles = handles; // { liftSlide }
    this.n = robot.joints.length;

    // Whatever pose buildRSJoints() left the arm in (its "ready" pose) is
    // "reset" for this sim, matching how the old arm re-zeroed on reset.
    this.readyPose = robot.joints.map(j => j.value);
    this.target = this.readyPose.slice();
    this.jointSpeed = 1.3; // rad/s, uniform across joints

    this._baseLiftY = handles.liftSlide ? handles.liftSlide.position.y : 0;
    this.lift = 0;
    this.targetLift = 0;
    this.liftSpeed = 0.45;

    this.gripper = 0;
    this.targetGrip = 0;
    this.gripSpeed = 1.6;
  }

  reset() {
    this.applyPose({ joints: this.readyPose, lift: 0, grip: 0 });
  }

  nudgeJoint(i, delta) {
    const j = this.robot.joints[i];
    if (!j) return;
    this.target[i] = THREE.MathUtils.clamp(this.target[i] + delta, j.min, j.max);
  }

  nudgeLift(delta, max) {
    this.targetLift = THREE.MathUtils.clamp(this.targetLift + delta, 0, max);
  }

  setGripper(open01) {
    this.targetGrip = THREE.MathUtils.clamp(open01, 0, 1);
  }

  step(dt) {
    const stepTo = (cur, tgt, speed) => {
      const d = tgt - cur;
      const m = speed * dt;
      if (Math.abs(d) <= m) return tgt;
      return cur + Math.sign(d) * m;
    };
    for (let i = 0; i < this.n; i++) {
      const j = this.robot.joints[i];
      j.value = stepTo(j.value, this.target[i], this.jointSpeed);
      this.robot._applyJointTransform(j);
    }
    this.lift = stepTo(this.lift, this.targetLift, this.liftSpeed);
    if (this.handles.liftSlide) this.handles.liftSlide.position.y = this._baseLiftY + this.lift;
    this.gripper = stepTo(this.gripper, this.targetGrip, this.gripSpeed);
    this.robot.setGripperOpen?.(this.gripper);
  }

  isAtTarget(tol = 0.04) {
    for (let i = 0; i < this.n; i++) {
      if (Math.abs(this.robot.joints[i].value - this.target[i]) > tol) return false;
    }
    return Math.abs(this.lift - this.targetLift) < 0.01;
  }

  /** World-space grasp point (the last joint's tip — the RS gripper's jaws). */
  toolWorldPosition() {
    return this.robot.getEndEffectorWorldPosition(new THREE.Vector3());
  }

  snapshot() {
    return {
      joints: this.robot.joints.map(j => j.value),
      lift: this.lift,
      grip: this.gripper,
    };
  }

  /** Set both the live pose and its target immediately (no easing) — used to
   *  restore a recorded/scrubbed frame rather than drive toward it. */
  applyPose(s) {
    if (!s) return;
    const joints = s.joints || this.readyPose;
    for (let i = 0; i < this.n; i++) {
      const v = joints[i] ?? this.readyPose[i] ?? 0;
      this.target[i] = v;
      this.robot.joints[i].value = v;
      this.robot._applyJointTransform(this.robot.joints[i]);
    }
    this.lift = this.targetLift = s.lift ?? 0;
    if (this.handles.liftSlide) this.handles.liftSlide.position.y = this._baseLiftY + this.lift;
    this.gripper = this.targetGrip = s.grip ?? 0;
    this.robot.setGripperOpen?.(this.gripper);
  }
}
