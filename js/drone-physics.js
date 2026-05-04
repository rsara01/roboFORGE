// Quadrotor rigid-body dynamics. Body frame: +X right, +Y up, +Z forward.
// State integrated in world frame. Forces: total thrust along body-Y, gravity,
// quadratic linear drag, angular drag. Motor mixing: collective thrust + roll
// + pitch + yaw torques. Hit-by-projectile flips the drone into a "wrecked"
// mode where motors die and tumbling angular velocity is kicked.

import * as THREE from 'three';

const g = 9.81;

export class DronePhysics {
  constructor() {
    this.mass = 1.2;            // kg
    this.armLength = 0.18;      // m, motor offset from CG
    this.dragLinear = 0.35;     // N per (m/s)^2
    this.dragAngular = 0.20;    // Nm per (rad/s)^2
    this.maxThrust = 22;        // N total (4 motors saturated, ~1.9x weight)
    this.kThrust = this.maxThrust;
    this.kTorqueRP = 1.6;       // roll/pitch torque scale
    this.kTorqueY  = 0.3;       // yaw torque scale
    this.inertia = new THREE.Vector3(0.012, 0.022, 0.012);

    this.position = new THREE.Vector3(0, 1.2, 0);
    this.velocity = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();   // body-frame rates (p, q, r)
    this.collective = 0;                  // 0..1 normalized total thrust
    this.cmdMoment = new THREE.Vector3(); // commanded body torques (Mx, My, Mz)

    this.armed = true;
    this.wrecked = false;
    this.hp = 100;
    this.onGround = false;

    // Terrain hook: () => groundY at current XZ. Default is flat y=0.
    this.groundHeightFn = null;
  }

  reset(pos = new THREE.Vector3(0, 1.2, 0)) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.quat.identity();
    this.angVel.set(0, 0, 0);
    this.collective = 0;
    this.cmdMoment.set(0, 0, 0);
    this.armed = true;
    this.wrecked = false;
    this.hp = 100;
    this.onGround = false;
  }

  // External hit (from sentry projectile). dmg in HP, dir in world space.
  damage(dmg, dir = null) {
    this.hp -= dmg;
    if (dir) {
      // Knock the drone with an impulse and impart tumble.
      const impulse = dir.clone().normalize().multiplyScalar(dmg * 0.06);
      this.velocity.add(impulse);
      this.angVel.x += (Math.random() - 0.5) * 8;
      this.angVel.y += (Math.random() - 0.5) * 4;
      this.angVel.z += (Math.random() - 0.5) * 8;
    }
    if (this.hp <= 0 && !this.wrecked) {
      this.wrecked = true;
      this.armed = false;
      this.collective = 0;
      this.cmdMoment.set(0, 0, 0);
      // Motors die: any residual rates persist, plus a violent tumble.
      this.angVel.x += (Math.random() - 0.5) * 6;
      this.angVel.z += (Math.random() - 0.5) * 6;
    }
  }

  // Inputs:
  //   collective: 0..1
  //   moment: Vector3 (Mx body-roll, My body-yaw, Mz body-pitch — Three.js
  //           uses Y as up, so we follow that convention here).
  applyControl(collective, moment) {
    if (this.wrecked || !this.armed) return;
    this.collective = THREE.MathUtils.clamp(collective, 0, 1);
    this.cmdMoment.copy(moment);
  }

  step(dt) {
    if (dt <= 0 || dt > 0.05) dt = 0.016;

    // ---- forces ----------------------------------------------------------
    const fGravity = new THREE.Vector3(0, -this.mass * g, 0);

    // Thrust along body +Y (rotor disk's "up").
    const thrustMag = this.armed && !this.wrecked
      ? this.collective * this.kThrust
      : 0;
    const thrustWorld = new THREE.Vector3(0, thrustMag, 0).applyQuaternion(this.quat);

    // Quadratic linear drag opposing velocity.
    const v = this.velocity;
    const speed = v.length();
    const fDrag = speed > 1e-4
      ? v.clone().multiplyScalar(-this.dragLinear * speed)
      : new THREE.Vector3();

    const force = new THREE.Vector3()
      .add(fGravity)
      .add(thrustWorld)
      .add(fDrag);

    // ---- linear integration ---------------------------------------------
    const acc = force.divideScalar(this.mass);
    this.velocity.addScaledVector(acc, dt);
    this.position.addScaledVector(this.velocity, dt);

    // ---- ground contact --------------------------------------------------
    const groundY = this.groundHeightFn
      ? this.groundHeightFn(this.position.x, this.position.z)
      : 0.0;
    if (this.position.y < groundY + 0.05) {
      this.position.y = groundY + 0.05;
      const downSpeed = -this.velocity.y;
      if (this.wrecked && downSpeed > 4) {
        // Hard crash — kill remaining motion, dramatic stop.
        this.velocity.multiplyScalar(0);
        this.angVel.multiplyScalar(0.3);
      } else {
        this.velocity.y = Math.max(0, this.velocity.y * -0.2);
        this.velocity.x *= 0.85;
        this.velocity.z *= 0.85;
      }
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // ---- angular dynamics -----------------------------------------------
    const M = this.cmdMoment;
    const I = this.inertia;
    const w = this.angVel;
    // Angular drag.
    const wMag = w.length();
    const Mdrag = wMag > 1e-4
      ? w.clone().multiplyScalar(-this.dragAngular * wMag)
      : new THREE.Vector3();
    const Mtot = M.clone().add(Mdrag);
    const alpha = new THREE.Vector3(Mtot.x / I.x, Mtot.y / I.y, Mtot.z / I.z);
    w.addScaledVector(alpha, dt);

    // Integrate orientation: dq/dt = 0.5 * q * omega_quat
    const omegaQuat = new THREE.Quaternion(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0);
    const dq = new THREE.Quaternion().multiplyQuaternions(this.quat, omegaQuat);
    this.quat.x += dq.x;
    this.quat.y += dq.y;
    this.quat.z += dq.z;
    this.quat.w += dq.w;
    this.quat.normalize();
  }

  // Convenience: world-frame Euler (roll, pitch, yaw) in radians.
  getEuler() {
    const e = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ');
    return { roll: e.z, pitch: e.x, yaw: e.y };
  }
}
