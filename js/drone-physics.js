

import * as THREE from 'three';

const G = 9.81;

export class DronePhysics {
  constructor() {

    this.mass = 2.0;
    this.armLength = 0.40;
    this.dragLinear = 0.55;
    this.dragAngular = 0.40;
    this.inertia = new THREE.Vector3(0.025, 0.045, 0.025);

    this.numMotors = 8;
    this.maxThrust = 40;
    this.fMax = this.maxThrust / this.numMotors;
    this.omegaMax = 1100;
    this.kT = this.fMax / (this.omegaMax * this.omegaMax);
    this.kQ = 0.012 * this.kT;

    this.kThrust = this.maxThrust;

    const L = this.armLength;
    this.motors = [];
    for (let i = 0; i < this.numMotors; i++) {
      const theta = (i * Math.PI * 2) / this.numMotors;
      this.motors.push({
        x: Math.cos(theta) * L,
        z: Math.sin(theta) * L,
        spin: (i % 2 === 0) ? +1 : -1,
        sin: Math.sin(theta),
        cos: Math.cos(theta),
        name: `M${i}`,
      });
    }
    this.omega   = new Array(this.numMotors).fill(0);
    this.thrusts = new Array(this.numMotors).fill(0);

    this.position = new THREE.Vector3(0, 1.2, 0);
    this.velocity = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.collective = 0;
    this.cmdMoment = new THREE.Vector3();

    this.armed = true;
    this.wrecked = false;
    this.hp = 100;
    this.onGround = false;

    this.gravityEnabled = true;
    this.dragEnabled = true;
    this.wind = new THREE.Vector3();
    this.gustImpulse = new THREE.Vector3();

    this.groundHeightFn = null;

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

  applyImpulse(v) { this.gustImpulse.add(v); }

  applyControl(collective, moment) {
    if (this.wrecked || !this.armed) return;
    this.collective = THREE.MathUtils.clamp(collective, 0, 1);
    this.cmdMoment.copy(moment);
  }

  _mixMotors() {
    const Tdes = this.collective * this.kThrust;
    const Mx = this.cmdMoment.x;
    const My = this.cmdMoment.y;
    const Mz = this.cmdMoment.z;
    const L = this.armLength;
    const c = this.kQ / this.kT;
    const N = this.numMotors;

    const a = Tdes / N;
    const cx = 1 / (4 * L);
    const cz = 1 / (4 * L);
    const cy = 1 / (N * c);

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

    let Tbody = 0;
    let Mbody = new THREE.Vector3();
    if (this.armed && !this.wrecked) {
      const mix = this._mixMotors();
      Tbody = mix.Tbody;
      Mbody = mix.Mbody;
    } else {
      for (let i = 0; i < this.numMotors; i++) { this.omega[i] = 0; this.thrusts[i] = 0; }
    }

    const force = new THREE.Vector3();

    if (this.gravityEnabled) {
      force.y -= this.mass * G;
    }

    const thrustWorld = new THREE.Vector3(0, Tbody, 0).applyQuaternion(this.quat);
    force.add(thrustWorld);

    if (this.dragEnabled) {
      const vRel = this.velocity.clone().sub(this.wind);
      const speed = vRel.length();
      if (speed > 1e-4) {
        force.addScaledVector(vRel, -this.dragLinear * speed);
      }
    }

    const acc = force.divideScalar(this.mass);
    this.velocity.addScaledVector(acc, dt);

    if (this.gustImpulse.lengthSq() > 0) {
      this.velocity.add(this.gustImpulse);
      this.gustImpulse.set(0, 0, 0);
    }

    this.position.addScaledVector(this.velocity, dt);

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

    if (this.collideFn) {
      const yBefore = this.position.y;
      this.collideFn(this.position, this.velocity, this.collideRadius);
      if (!this.onGround && this.position.y > yBefore + 0.005) this.onGround = true;
    }

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

    const omegaQuat = new THREE.Quaternion(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0);
    const dq = new THREE.Quaternion().multiplyQuaternions(this.quat, omegaQuat);
    this.quat.x += dq.x;
    this.quat.y += dq.y;
    this.quat.z += dq.z;
    this.quat.w += dq.w;
    this.quat.normalize();
  }

  getEuler() {
    const e = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ');
    return { roll: e.z, pitch: e.x, yaw: e.y };
  }
}
