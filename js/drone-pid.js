

import * as THREE from 'three';

class PID {
  constructor(kp, ki, kd, iLimit = Infinity) {
    this.kp = kp; this.ki = ki; this.kd = kd; this.iLimit = iLimit;
    this.integral = 0;
    this.prev = 0;
    this.firstStep = true;
  }
  reset() { this.integral = 0; this.prev = 0; this.firstStep = true; }
  step(error, dt) {
    this.integral = Math.max(-this.iLimit, Math.min(this.iLimit, this.integral + error * dt));
    const d = this.firstStep ? 0 : (error - this.prev) / Math.max(dt, 1e-4);
    this.firstStep = false;
    this.prev = error;
    return this.kp * error + this.ki * this.integral + this.kd * d;
  }
}

export class DroneController {
  constructor(physics) {
    this.physics = physics;
    this.gains = {

      pos:  { kp: 1.2, ki: 0.0, kd: 0.0 },

      vel:  { kp: 0.30, ki: 0.02, kd: 0.05 },

      alt:  { kp: 4.5, ki: 1.5, kd: 2.5 },

      yaw:  { kp: 2.5, ki: 0.0, kd: 0.0 },

      att:  { kp: 8.0, ki: 0.0, kd: 1.4 },

      yawRate: { kp: 0.6, ki: 0.0, kd: 0.05 },
    };
    this._build();

    this.hoverCollective = (physics.mass * 9.81) / physics.kThrust;

    this.target = new THREE.Vector3(0, 1.5, 0);
    this.targetYaw = 0;
    this.maxTilt = 0.45;
    this.maxClimbRate = 4.0;
    this.maxYawRate = 2.5;

    this.manual = { active: false, pitch: 0, roll: 0, yawRate: 0, climbRate: 0 };
  }

  setManualInput({ pitch = 0, roll = 0, yawRate = 0, climbRate = 0 } = {}) {
    this.manual.active = true;
    this.manual.pitch = pitch;
    this.manual.roll = roll;
    this.manual.yawRate = yawRate;
    this.manual.climbRate = climbRate;
  }

  clearManualInput() {
    this.manual.active = false;
    this.manual.pitch = 0;
    this.manual.roll = 0;
    this.manual.yawRate = 0;
    this.manual.climbRate = 0;
  }

  _build() {
    this.posX = new PID(this.gains.pos.kp, this.gains.pos.ki, this.gains.pos.kd, 3);
    this.posZ = new PID(this.gains.pos.kp, this.gains.pos.ki, this.gains.pos.kd, 3);
    this.velX = new PID(this.gains.vel.kp, this.gains.vel.ki, this.gains.vel.kd, 0.4);
    this.velZ = new PID(this.gains.vel.kp, this.gains.vel.ki, this.gains.vel.kd, 0.4);
    this.alt  = new PID(this.gains.alt.kp, this.gains.alt.ki, this.gains.alt.kd, 1.0);
    this.yaw  = new PID(this.gains.yaw.kp, this.gains.yaw.ki, this.gains.yaw.kd, 1.5);
    this.attR = new PID(this.gains.att.kp, this.gains.att.ki, this.gains.att.kd, 1.0);
    this.attP = new PID(this.gains.att.kp, this.gains.att.ki, this.gains.att.kd, 1.0);
    this.yawR = new PID(this.gains.yawRate.kp, this.gains.yawRate.ki, this.gains.yawRate.kd, 1.0);
  }

  setGain(group, key, value) {
    this.gains[group][key] = value;
    this._build();
  }

  setTarget(pos, yaw = null) {
    this.target.copy(pos);
    if (yaw != null) this.targetYaw = yaw;
  }

  reset() { this._build(); }

  step(dt) {
    const p = this.physics;
    if (p.wrecked || !p.armed) return { collective: 0, moment: new THREE.Vector3() };

    const pos = p.position;
    const vel = p.velocity;
    const eul = p.getEuler();

    let pitchDes, rollDes, yawRateDes;

    if (this.manual.active) {
      this.target.y += this.manual.climbRate * this.maxClimbRate * dt;
      pitchDes = this.manual.pitch * this.maxTilt;
      rollDes  = -this.manual.roll * this.maxTilt;
      yawRateDes = this.manual.yawRate * this.maxYawRate;
      this.targetYaw = eul.yaw;
      this.target.x = pos.x;
      this.target.z = pos.z;
    } else {
      const ex = this.target.x - pos.x;
      const ez = this.target.z - pos.z;
      const vDesX = THREE.MathUtils.clamp(this.posX.step(ex, dt), -3, 3);
      const vDesZ = THREE.MathUtils.clamp(this.posZ.step(ez, dt), -3, 3);

      const cy = Math.cos(eul.yaw), sy = Math.sin(eul.yaw);
      const evX = vDesX - vel.x;
      const evZ = vDesZ - vel.z;
      const accX = this.velX.step(evX, dt);
      const accZ = this.velZ.step(evZ, dt);

      const bodyAccZ =  cy * accZ + sy * accX;
      const bodyAccX = -sy * accZ + cy * accX;
      pitchDes = THREE.MathUtils.clamp( bodyAccZ, -this.maxTilt, this.maxTilt);
      rollDes  = THREE.MathUtils.clamp(-bodyAccX, -this.maxTilt, this.maxTilt);

      const yawErr = wrapAngle(this.targetYaw - eul.yaw);
      yawRateDes = THREE.MathUtils.clamp(this.yaw.step(yawErr, dt), -this.maxYawRate, this.maxYawRate);
    }

    const eAlt = this.target.y - pos.y;
    const altDelta = THREE.MathUtils.clamp(this.alt.step(eAlt, dt), -0.6, 0.6);
    let collective = this.hoverCollective + altDelta;
    collective = THREE.MathUtils.clamp(collective, 0, 1);

    const yawTorque = this.yawR.step(yawRateDes - p.angVel.y, dt);

    const rollTorque  = this.attR.step(rollDes  - eul.roll,  dt);
    const pitchTorque = this.attP.step(pitchDes - eul.pitch, dt);

    return {
      collective,
      moment: new THREE.Vector3(pitchTorque, yawTorque, rollTorque),
    };
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
