

import * as THREE from 'three';

export class DosePhysics {
  constructor() {
    this.position = new THREE.Vector3(0, 0, 0);
    this.heading = 0;
    this.linVel = 0;
    this.angVel = 0;

    this.wheelBase = 0.55;
    this.wheelRadius = 0.115;

    this.maxLinSpeed = 1.6;
    this.maxAngSpeed = 2.2;
    this.linAccel = 2.4;
    this.angAccel = 6.0;

    this.cmdLin = 0;
    this.cmdAng = 0;

    this.bodyHalfW = 0.30;
    this.bodyHalfD = 0.24;

    this.colliders = [];

    this.wheelSpinL = 0;
    this.wheelSpinR = 0;
  }

  reset(pos = new THREE.Vector3(0, 0, 0), heading = 0) {
    this.position.copy(pos);
    this.heading = heading;
    this.linVel = 0;
    this.angVel = 0;
    this.cmdLin = 0;
    this.cmdAng = 0;
    this.wheelSpinL = 0;
    this.wheelSpinR = 0;
  }

  setColliders(list) { this.colliders = list || []; }

  command(lin, ang) {
    this.cmdLin = THREE.MathUtils.clamp(lin, -1, 1) * this.maxLinSpeed;
    this.cmdAng = THREE.MathUtils.clamp(ang, -1, 1) * this.maxAngSpeed;
  }

  step(dt) {
    const dvLin = THREE.MathUtils.clamp(this.cmdLin - this.linVel, -this.linAccel * dt, this.linAccel * dt);
    this.linVel += dvLin;
    const dvAng = THREE.MathUtils.clamp(this.cmdAng - this.angVel, -this.angAccel * dt, this.angAccel * dt);
    this.angVel += dvAng;

    this.heading += this.angVel * dt;
    const dx = Math.sin(this.heading) * this.linVel * dt;
    const dz = Math.cos(this.heading) * this.linVel * dt;

    const next = this.position.clone();
    next.x += dx; next.z += dz;
    if (this._collides(next)) {
      const tryX = this.position.clone(); tryX.x += dx;
      if (!this._collides(tryX)) { this.position.copy(tryX); }
      else {
        const tryZ = this.position.clone(); tryZ.z += dz;
        if (!this._collides(tryZ)) { this.position.copy(tryZ); }
        else { this.linVel *= 0.2; }
      }
    } else {
      this.position.copy(next);
    }

    const vL = this.linVel - (this.angVel * this.wheelBase / 2);
    const vR = this.linVel + (this.angVel * this.wheelBase / 2);
    this.wheelSpinL += (vL / this.wheelRadius) * dt;
    this.wheelSpinR += (vR / this.wheelRadius) * dt;
  }

  _collides(p) {
    const cosH = Math.cos(this.heading);
    const sinH = Math.sin(this.heading);
    const corners = [
      [+this.bodyHalfW, +this.bodyHalfD],
      [-this.bodyHalfW, +this.bodyHalfD],
      [-this.bodyHalfW, -this.bodyHalfD],
      [+this.bodyHalfW, -this.bodyHalfD],
    ];
    for (const c of this.colliders) {
      if (!c.aabb) continue;
      const minX = c.aabb.minX, maxX = c.aabb.maxX;
      const minZ = c.aabb.minZ, maxZ = c.aabb.maxZ;
      for (const [lx, lz] of corners) {
        const wx = p.x + lx * cosH - lz * sinH;
        const wz = p.z + lx * sinH + lz * cosH;
        if (wx >= minX && wx <= maxX && wz >= minZ && wz <= maxZ) return true;
      }
    }
    return false;
  }
}
