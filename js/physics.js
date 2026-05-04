

import * as THREE from 'three';
import { Sound } from './sound.js';

const GRAVITY = -9.81;

export class MiniPhysics {
  constructor(scene) {
    this.scene = scene;
    this.bodies = [];
    this.enabled = false;
  }

  setEnabled(v) { this.enabled = !!v; }

spawnBox(position = new THREE.Vector3(0.5, 0.05, 0.0), size = 0.06, color = 0xffaa55, mass = 0.05) {
    const halfExtents = size / 2;
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(position);
    this.scene.add(mesh);
    const body = {
      mesh, halfExtents,
      mass,
      vel: new THREE.Vector3(),
      attachedTo: null,
      pickable: true,
    };
    this.bodies.push(body);
    return body;
  }

  removeAll() {
    for (const b of this.bodies) {
      if (b.attachedTo) b.attachedTo.remove(b.mesh);
      else this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    }
    this.bodies.length = 0;
  }

  spawnDefaultBlocks() {
    this.spawnBox({ x: 0.5,  y: 0.05, z:  0.0  }, 0.06, 0xffaa55);
    this.spawnBox({ x: 0.55, y: 0.05, z:  0.15 }, 0.06, 0x55ddaa);
    this.spawnBox({ x: 0.45, y: 0.05, z: -0.15 }, 0.06, 0xaaaaff);
  }

  resetBlocks() {
    this.removeAll();
    this.spawnDefaultBlocks();
  }

  scanBlocks(tipObject, { fov = Math.PI / 3, range = 2.5, forward = 'z' } = {}) {
    if (!tipObject) return [];
    tipObject.updateWorldMatrix(true, false);
    const tipPos = new THREE.Vector3().setFromMatrixPosition(tipObject.matrixWorld);
    const fwdLocal = forward === 'x' ? new THREE.Vector3(1, 0, 0)
                  : forward === 'y' ? new THREE.Vector3(0, 1, 0)
                  :                   new THREE.Vector3(0, 0, 1);
    const tipQuat = new THREE.Quaternion().setFromRotationMatrix(tipObject.matrixWorld);
    const fwd = fwdLocal.applyQuaternion(tipQuat).normalize();

    const out = [];
    const wp = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (const b of this.bodies) {
      if (b.attachedTo && b.attachedTo.isObject3D) continue;
      wp.setFromMatrixPosition(b.mesh.matrixWorld);
      dir.copy(wp).sub(tipPos);
      const dist = dir.length();
      if (dist > range || dist < 1e-4) continue;
      dir.divideScalar(dist);
      const ang = Math.acos(THREE.MathUtils.clamp(dir.dot(fwd), -1, 1));
      if (ang > fov / 2) continue;
      out.push({ body: b, distance: dist, angle: ang, worldPos: wp.clone() });
    }
    out.sort((a, b) => a.distance - b.distance);
    return out;
  }

  setBlockHighlight(body, on, color = 0x6effa1) {
    if (!body) return;
    const m = body.mesh.material;
    if (on) {
      if (body._origEmissive == null) body._origEmissive = m.emissive.getHex();
      m.emissive.setHex(color);
    } else if (body._origEmissive != null) {
      m.emissive.setHex(body._origEmissive);
      body._origEmissive = null;
    }
  }

  sliceBlock(body, splitDir = new THREE.Vector3(1, 0, 0)) {
    const idx = this.bodies.indexOf(body);
    if (idx < 0) return;
    const fullSize = body.halfExtents * 2;
    const halfSize = fullSize * 0.48;
    const colorHex = body.mesh.material.color.getHex();
    body.mesh.updateWorldMatrix(true, false);
    const center = new THREE.Vector3().setFromMatrixPosition(body.mesh.matrixWorld);

    const dir = splitDir.clone();
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();

    if (body.attachedTo) body.attachedTo.remove(body.mesh);
    else this.scene.remove(body.mesh);
    body.mesh.geometry.dispose();
    body.mesh.material.dispose();
    this.bodies.splice(idx, 1);

    const offset = fullSize * 0.30;
    const a = this.spawnBox(
      { x: center.x + dir.x * offset, y: center.y, z: center.z + dir.z * offset },
      halfSize, colorHex
    );
    const b = this.spawnBox(
      { x: center.x - dir.x * offset, y: center.y, z: center.z - dir.z * offset },
      halfSize, colorHex
    );
    a.vel.set( dir.x * 0.6, 1.0,  dir.z * 0.6);
    b.vel.set(-dir.x * 0.6, 1.0, -dir.z * 0.6);
    return [a, b];
  }

tryGrab(tipObject, radius = 0.04) {

    tipObject.updateWorldMatrix(true, false);
    const tipPos = new THREE.Vector3().setFromMatrixPosition(tipObject.matrixWorld);
    let best = null, bestPenetration = -Infinity;
    const tmp = new THREE.Vector3();
    for (const b of this.bodies) {
      if (b.attachedTo && b.attachedTo.isObject3D) continue;
      tmp.setFromMatrixPosition(b.mesh.matrixWorld);
      const d = tmp.distanceTo(tipPos);
      const reach = (b.halfExtents || 0.03) + radius;
      if (d <= reach) {
        const pen = reach - d;
        if (pen > bestPenetration) { bestPenetration = pen; best = b; }
      }
    }
    if (best) {
      const worldQuat = new THREE.Quaternion().setFromRotationMatrix(best.mesh.matrixWorld);
      this.scene.remove(best.mesh);
      tipObject.add(best.mesh);

      best.mesh.position.set(0, 0, 0);
      const tipQuat = new THREE.Quaternion().setFromRotationMatrix(tipObject.matrixWorld);
      best.mesh.quaternion.copy(tipQuat.invert().multiply(worldQuat));
      best.attachedTo = tipObject;
      best.vel.set(0, 0, 0);

      _flashGrabRing(this.scene, tipPos, 0x6effa1);
      Sound.grab();
    } else {
      _flashGrabRing(this.scene, tipPos, 0xff5566);
      Sound.err();
    }
    return best;
  }

release(tipObject = null) {
    let released = false;
    for (const b of this.bodies) {
      if (b.attachedTo && (!tipObject || b.attachedTo === tipObject)) {
        b.mesh.updateWorldMatrix(true, false);
        const wp = new THREE.Vector3().setFromMatrixPosition(b.mesh.matrixWorld);
        const wq = new THREE.Quaternion().setFromRotationMatrix(b.mesh.matrixWorld);
        b.attachedTo.remove(b.mesh);
        this.scene.add(b.mesh);
        b.mesh.position.copy(wp);
        b.mesh.quaternion.copy(wq);

        b.attachedTo = null;
        b.vel.set(0, 0, 0);
        released = true;
      }
    }
    if (released) Sound.release();
  }

  registerSurface(aabbFn) {
    if (!this._surfaces) this._surfaces = [];
    this._surfaces.push(aabbFn);
  }

  step(dt) {
    _stepFlashes(dt > 0 ? dt : 0.016);
    if (!this.enabled) return;
    if (dt <= 0 || dt > 0.1) dt = 0.016;
    const surfaces = (this._surfaces || []).map(fn => fn()).filter(Boolean);

    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (b.attachedTo) continue;

      b.vel.y += GRAVITY * dt;
      b.mesh.position.x += b.vel.x * dt;
      b.mesh.position.y += b.vel.y * dt;
      b.mesh.position.z += b.vel.z * dt;

      let resting = false;
      if (b.mesh.position.y < b.halfExtents) {
        b.mesh.position.y = b.halfExtents;
        if (b.vel.y < 0) b.vel.y = -b.vel.y * 0.25;
        if (Math.abs(b.vel.y) < 0.05) b.vel.y = 0;
        b.vel.x *= 0.85;
        b.vel.z *= 0.85;
        resting = true;
      }

      for (const s of surfaces) {
        const px = b.mesh.position.x;
        const pz = b.mesh.position.z;
        if (px < s.minX || px > s.maxX || pz < s.minZ || pz > s.maxZ) continue;
        const restY = s.top + b.halfExtents;
        if (b.mesh.position.y < restY && b.vel.y <= 0) {
          b.mesh.position.y = restY;
          b.vel.y = -b.vel.y * 0.2;
          if (Math.abs(b.vel.y) < 0.05) b.vel.y = 0;
          b.vel.x *= 0.9;
          b.vel.z *= 0.9;
          resting = true;
        }
      }

      for (const o of this.bodies) {
        if (o === b || o.attachedTo) continue;
        const dx = Math.abs(b.mesh.position.x - o.mesh.position.x);
        const dz = Math.abs(b.mesh.position.z - o.mesh.position.z);
        const reachXZ = b.halfExtents + o.halfExtents;
        if (dx > reachXZ || dz > reachXZ) continue;
        const restY = o.mesh.position.y + o.halfExtents + b.halfExtents;
        if (b.mesh.position.y < restY && b.vel.y <= 0 && b.mesh.position.y > o.mesh.position.y) {
          b.mesh.position.y = restY;
          b.vel.y = 0;
          b.vel.x *= 0.85;
          b.vel.z *= 0.85;
          resting = true;
        }
      }

      if (b.mesh.position.y < -3 || Math.abs(b.mesh.position.x) > 20 || Math.abs(b.mesh.position.z) > 20) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this.bodies.splice(i, 1);
      }
    }
  }
}

const _flashes = [];

function _flashGrabRing(scene, worldPos, colorHex) {
  const geo = new THREE.TorusGeometry(0.04, 0.005, 8, 28);
  const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.95 });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.copy(worldPos);
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);
  _flashes.push({ ring, scene, life: 0, dur: 0.45 });
}

function _stepFlashes(dt) {
  for (let i = _flashes.length - 1; i >= 0; i--) {
    const f = _flashes[i];
    f.life += dt;
    const u = f.life / f.dur;
    if (u >= 1) {
      f.scene.remove(f.ring);
      f.ring.geometry.dispose();
      f.ring.material.dispose();
      _flashes.splice(i, 1);
      continue;
    }
    const s = 1 + u * 4;
    f.ring.scale.set(s, s, s);
    f.ring.material.opacity = 0.9 * (1 - u);
  }
}
