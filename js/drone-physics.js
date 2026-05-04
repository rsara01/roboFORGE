// Octocopter rigid-body dynamics with an explicit 8-motor model.
//
// Body frame: +X right, +Y up, +Z forward. State integrated in world frame.
//
// Motor layout: 8 motors evenly spaced 45° apart in the body XZ plane.
// Spin direction alternates so reaction torques cancel in hover (CCW, CW, ...).
// Indexing starts at +X (motor 0) and proceeds CCW around +Y.
//
//                +Z (forward)
//                  ^
//          M3      M2      M1
//             \    |    /
//              \   |   /
//        M4 ---  body  --- M0     ----> +X (right)
//              /   |   \
//             /    |    \
//          M5      M6      M7
//
// Each motor i sits at body position (cos θ_i · L, 0, sin θ_i · L) with
// θ_i = i · 45°, spin sign s_i = (-1)^i (M0 CCW), and produces:
//   thrust  f_i  = kT · ω_i²        along body +Y
//   yaw torque   = s_i · kQ · ω_i²   about body +Y
//
// Body forces / torques summed over all motors:
//   T  = Σ f_i                                  (total thrust along body +Y)
//   Mx = -Σ z_i · f_i = -L · Σ sin θ_i · f_i    (pitch torque)
//   Mz = +Σ x_i · f_i = +L · Σ cos θ_i · f_i    (roll torque)
//   My = c · Σ s_i · f_i                        (yaw torque, c = kQ/kT)
//
// The 4×8 mix is rank-4 underdetermined; we use the closed-form min-norm
// (Moore-Penrose) inverse, exploiting Σ sin² = Σ cos² = 4 and Σ s² = 8:
//
//   f_i = T/8  -  sin θ_i / (4L) · Mx
//             +  s_i      / (8c) · My
//             +  cos θ_i / (4L) · Mz
//
// Per-motor thrust is clamped to [0, fMax]; after clamping we recompute the
// actually-delivered T and M from the (possibly saturated) f_i so commanding
// beyond motor authority degrades gracefully instead of cheating physics.
//
// Other forces: gravity, quadratic linear drag (against air-relative velocity
// so wind is absorbed naturally), quadratic angular drag.
//
// Gravity, drag, and wind can be toggled independently for debugging /
// tuning. Disturbance impulses can be injected via .applyImpulse().

import * as THREE from 'three';

const G = 9.81;

export class DronePhysics {
  constructor() {
    // ---- vehicle parameters --------------------------------------------
    // A larger 8-rotor airframe. Mass and inertia scaled up versus the quad
    // baseline so PID response stays in a sane range with 8 motors of
    // similar individual authority.
    this.mass = 2.0;            // kg
    this.armLength = 0.40;      // m, motor offset from CG (in body XZ plane)
    this.dragLinear = 0.55;     // N per (m/s)²
    this.dragAngular = 0.40;    // N·m per (rad/s)²
    this.inertia = new THREE.Vector3(0.025, 0.045, 0.025); // (Ix, Iy, Iz)

    // ---- motor parameters ----------------------------------------------
    // 8 motors. Total max thrust sized for ~2x weight (T/W ≈ 2.0).
    this.numMotors = 8;
    this.maxThrust = 40;                              // N total at full ω
    this.fMax = this.maxThrust / this.numMotors;      // N per motor
    this.omegaMax = 1100;                             // rad/s, motor saturation
    this.kT = this.fMax / (this.omegaMax * this.omegaMax);
    this.kQ = 0.012 * this.kT;                        // yaw-torque coefficient

    // Public field used by the controller to size its altitude-PID output.
    this.kThrust = this.maxThrust;

    // Motor positions, spin signs, and trig coefficients (precomputed for the
    // hot mixing loop). i = 0 starts at +X, going CCW around +Y in 45° steps.
    const L = this.armLength;
    this.motors = [];
    for (let i = 0; i < this.numMotors; i++) {
      const theta = (i * Math.PI * 2) / this.numMotors;
      this.motors.push({
        x: Math.cos(theta) * L,
        z: Math.sin(theta) * L,
        spin: (i % 2 === 0) ? +1 : -1,                // alternate CCW / CW
        sin: Math.sin(theta),
        cos: Math.cos(theta),
        name: `M${i}`,
      });
    }
    this.omega   = new Array(this.numMotors).fill(0);
    this.thrusts = new Array(this.numMotors).fill(0);

    // ---- state ---------------------------------------------------------
    this.position = new THREE.Vector3(0, 1.2, 0);
    this.velocity = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();   // body-frame rates (p, q, r)
    this.collective = 0;                  // commanded 0..1 normalized thrust
    this.cmdMoment = new THREE.Vector3(); // commanded body torques (Mx, My, Mz)

    this.armed = true;
    this.wrecked = false;
    this.hp = 100;
    this.onGround = false;

    // ---- environment toggles & disturbance -----------------------------
    this.gravityEnabled = true;
    this.dragEnabled = true;
    this.wind = new THREE.Vector3();      // world-frame steady wind (m/s)
    this.gustImpulse = new THREE.Vector3(); // one-shot world impulse (m/s)

    // Terrain hook: (x, z) => ground height (typically 0). Buildings/walls go
    // through collideFn instead, so this stays simple.
    this.groundHeightFn = null;
    // World-collision hook: (pos, vel, radius) => void. Mutates pos/vel in
    // place to resolve any AABB intersection with city geometry. Called every
    // step after linear integration.
    this.collideFn = null;
    this.collideRadius = 0.55;
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
    for (let i = 0; i < this.numMotors; i++) { this.omega[i] = 0; this.thrusts[i] = 0; }
    this.gustImpulse.set(0, 0, 0);
  }

  // External hit (from sentry projectile). dmg in HP, dir in world space.
  damage(dmg, dir = null) {
    this.hp -= dmg;
    if (dir) {
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
      this.angVel.x += (Math.random() - 0.5) * 6;
      this.angVel.z += (Math.random() - 0.5) * 6;
      for (let i = 0; i < this.numMotors; i++) { this.omega[i] = 0; this.thrusts[i] = 0; }
    }
  }

  // World-frame velocity impulse, in m/s. Used for wind-gust disturbance.
  applyImpulse(v) { this.gustImpulse.add(v); }

  // Inputs:
  //   collective: 0..1 (fraction of total max thrust)
  //   moment: Vector3 of commanded body torques — (Mx pitch, My yaw, Mz roll).
  applyControl(collective, moment) {
    if (this.wrecked || !this.armed) return;
    this.collective = THREE.MathUtils.clamp(collective, 0, 1);
    this.cmdMoment.copy(moment);
  }

  // Mix (collective, Mx, My, Mz) → per-motor thrusts via min-norm inverse,
  // clamp each to motor authority, back-solve ω from f, then recompute the
  // actually delivered T and M from the (possibly saturated) f_i.
  // Returns { Tbody, Mbody } in body frame.
  _mixMotors() {
    const Tdes = this.collective * this.kThrust;
    const Mx = this.cmdMoment.x;
    const My = this.cmdMoment.y;
    const Mz = this.cmdMoment.z;
    const L = this.armLength;
    const c = this.kQ / this.kT;
    const N = this.numMotors;

    const a = Tdes / N;            // even split for collective
    const cx = 1 / (4 * L);        // pitch coefficient (Σ sin² = N/2 = 4)
    const cz = 1 / (4 * L);        // roll  coefficient (Σ cos² = N/2 = 4)
    const cy = 1 / (N * c);        // yaw   coefficient (Σ s² = N)

    let Tactual = 0;
    let MxActual = 0, MyActual = 0, MzActual = 0;
    for (let i = 0; i < N; i++) {
      const m = this.motors[i];
      const fDes = a
        - m.sin * cx * Mx
        + m.spin * cy * My
        + m.cos * cz * Mz;
      const f = THREE.MathUtils.clamp(fDes, 0, this.fMax);
      this.thrusts[i] = f;
      this.omega[i] = Math.sqrt(f / this.kT);
      Tactual  += f;
      MxActual += -m.z * f;
      MzActual += +m.x * f;
      MyActual += m.spin * c * f;
    }
    return {
      Tbody: Tactual,
      Mbody: new THREE.Vector3(MxActual, MyActual, MzActual),
    };
  }

  step(dt) {
    if (dt <= 0 || dt > 0.05) dt = 0.016;

    // ---- mix to motors -------------------------------------------------
    let Tbody = 0;
    let Mbody = new THREE.Vector3();
    if (this.armed && !this.wrecked) {
      const mix = this._mixMotors();
      Tbody = mix.Tbody;
      Mbody = mix.Mbody;
    } else {
      for (let i = 0; i < this.numMotors; i++) { this.omega[i] = 0; this.thrusts[i] = 0; }
    }

    // ---- forces --------------------------------------------------------
    const force = new THREE.Vector3();

    if (this.gravityEnabled) {
      force.y -= this.mass * G;
    }

    // Body-frame thrust along +Y, rotated into world.
    const thrustWorld = new THREE.Vector3(0, Tbody, 0).applyQuaternion(this.quat);
    force.add(thrustWorld);

    // Quadratic drag against air-relative velocity (so wind affects the body).
    if (this.dragEnabled) {
      const vRel = this.velocity.clone().sub(this.wind);
      const speed = vRel.length();
      if (speed > 1e-4) {
        force.addScaledVector(vRel, -this.dragLinear * speed);
      }
    }

    // ---- linear integration -------------------------------------------
    const acc = force.divideScalar(this.mass);
    this.velocity.addScaledVector(acc, dt);

    // One-shot gust impulse (already a velocity delta in m/s).
    if (this.gustImpulse.lengthSq() > 0) {
      this.velocity.add(this.gustImpulse);
      this.gustImpulse.set(0, 0, 0);
    }

    this.position.addScaledVector(this.velocity, dt);

    // ---- ground contact ------------------------------------------------
    const groundY = this.groundHeightFn
      ? this.groundHeightFn(this.position.x, this.position.z)
      : 0.0;
    if (this.position.y < groundY + 0.05) {
      this.position.y = groundY + 0.05;
      const downSpeed = -this.velocity.y;
      if (this.wrecked && downSpeed > 4) {
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

    // ---- city / building collision ------------------------------------
    if (this.collideFn) {
      const yBefore = this.position.y;
      this.collideFn(this.position, this.velocity, this.collideRadius);
      if (!this.onGround && this.position.y > yBefore + 0.005) this.onGround = true;
    }

    // ---- angular dynamics ---------------------------------------------
    const I = this.inertia;
    const w = this.angVel;
    let MxNet = Mbody.x, MyNet = Mbody.y, MzNet = Mbody.z;

    if (this.dragEnabled) {
      const wMag = w.length();
      if (wMag > 1e-4) {
        const k = -this.dragAngular * wMag;
        MxNet += w.x * k;
        MyNet += w.y * k;
        MzNet += w.z * k;
      }
    }

    w.x += (MxNet / I.x) * dt;
    w.y += (MyNet / I.y) * dt;
    w.z += (MzNet / I.z) * dt;

    // Integrate orientation: dq/dt = 0.5 * q ⊗ ω_quat.
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
