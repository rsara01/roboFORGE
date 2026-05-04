

import * as THREE from 'three';

const SHAPES = ['cube', 'cylinder', 'pyramid'];
const PALETTE = [0xffaa55, 0x55ddaa, 0x6da9ff, 0xff7766, 0xc586ff, 0xffd75e];

export class Conveyor {
  constructor(scene, physics, opts = {}) {
    this.scene = scene;
    this.physics = physics;
    this.center  = opts.center  || new THREE.Vector3(0, 0.04, -0.7);
    this.dir     = (opts.dir    || new THREE.Vector3(1, 0, 0)).clone().normalize();
    this.length  = opts.length  || 1.6;
    this.width   = opts.width   || 0.30;
    this.speed   = opts.speed   ?? 0.18;
    this.spacing = opts.spacing ?? 0.30;
    this.height  = 0.06;
    this.enabled = false;

    this._buildVisual();
    physics.registerSurface(() => {
      if (!this.enabled) return null;

      const halfL = this.length / 2;
      const halfW = this.width / 2;

      const ux = this.dir.x, uz = this.dir.z;
      const vx = -uz, vz = ux;
      const xs = [
        this.center.x + ux * halfL + vx * halfW,
        this.center.x + ux * halfL - vx * halfW,
        this.center.x - ux * halfL + vx * halfW,
        this.center.x - ux * halfL - vx * halfW,
      ];
      const zs = [
        this.center.z + uz * halfL + vz * halfW,
        this.center.z + uz * halfL - vz * halfW,
        this.center.z - uz * halfL + vz * halfW,
        this.center.z - uz * halfL - vz * halfW,
      ];
      return {
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minZ: Math.min(...zs), maxZ: Math.max(...zs),
        top: this.center.y + this.height / 2,
      };
    });
  }

  _buildVisual() {
    const grp = new THREE.Group();
    grp.name = 'conveyor';

    const deckGeo = new THREE.BoxGeometry(this.length, this.height, this.width);
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x202832, roughness: 0.7, metalness: 0.3 });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.castShadow = deck.receiveShadow = true;
    grp.add(deck);

    const railMat = new THREE.MeshStandardMaterial({ color: 0x3a4452, roughness: 0.5, metalness: 0.5 });
    const railGeo = new THREE.BoxGeometry(this.length, 0.02, 0.01);
    for (const z of [-this.width / 2 - 0.005, this.width / 2 + 0.005]) {
      const r = new THREE.Mesh(railGeo, railMat);
      r.position.set(0, this.height / 2 + 0.01, z);
      grp.add(r);
    }

    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x5a6a80, roughness: 0.6, metalness: 0.2 });
    const stripeGeo = new THREE.PlaneGeometry(0.04, this.width * 0.85);
    const stripeOffset = this.height / 2 + 0.001;
    this._stripes = [];
    const count = Math.floor(this.length / 0.10);
    for (let i = 0; i < count; i++) {
      const s = new THREE.Mesh(stripeGeo, stripeMat);
      s.rotation.x = -Math.PI / 2;
      s.position.set(-this.length / 2 + 0.05 + i * 0.10, stripeOffset, 0);
      grp.add(s);
      this._stripes.push(s);
    }

    const ang = Math.atan2(this.dir.z, this.dir.x);
    grp.rotation.y = -ang;
    grp.position.copy(this.center);
    this.scene.add(grp);
    this.group = grp;
  }

  setEnabled(v) {
    this.enabled = !!v;
    this.group.visible = !!v;
    if (!v) this.removeAllBeltBlocks();
  }

  setSpeed(v) { this.speed = v; }

  resize({ length, width, center, dir } = {}) {
    if (length != null) this.length = length;
    if (width  != null) this.width  = width;
    if (center) this.center.copy(center);
    if (dir)    this.dir.copy(dir).normalize();

    this.removeAllBeltBlocks();

    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse(o => {
        if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); }
      });
    }
    const wasEnabled = this.enabled;
    this._buildVisual();
    this.group.visible = wasEnabled;
  }

  removeAllBeltBlocks() {
    const remove = this.physics.bodies.filter(b => b.attachedTo === this);
    for (const b of remove) {
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      const i = this.physics.bodies.indexOf(b);
      if (i >= 0) this.physics.bodies.splice(i, 1);
    }
  }

  _startWorld() { return this.center.clone().sub(this.dir.clone().multiplyScalar(this.length / 2 - 0.06)); }
  _endWorld()   { return this.center.clone().add(this.dir.clone().multiplyScalar(this.length / 2 - 0.06)); }

  spawnBlock(opts = {}) {
    const shape = opts.shape || SHAPES[Math.floor(Math.random() * SHAPES.length)];
    const color = opts.color != null ? opts.color : PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const size = opts.size || 0.06;
    let mesh;
    if (shape === 'cube') {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 })
      );
    } else if (shape === 'cylinder') {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(size * 0.45, size * 0.45, size, 18),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 })
      );
    } else {
      mesh = new THREE.Mesh(
        new THREE.ConeGeometry(size * 0.55, size, 4),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 })
      );
      mesh.rotation.y = Math.PI / 4;
    }
    mesh.castShadow = mesh.receiveShadow = true;

    const start = this._startWorld();
    mesh.position.set(start.x, this.center.y + this.height / 2 + size / 2, start.z);
    this.scene.add(mesh);

    const body = {
      mesh,
      halfExtents: size / 2,
      mass: opts.mass ?? 0.05,
      vel: new THREE.Vector3(),
      attachedTo: this,
      pickable: true,
      shape, color,
    };
    this.physics.bodies.push(body);
    return body;
  }

  step(dt) {
    if (!this.enabled) return;

    if (this._stripes) {
      const stripeMove = this.speed * dt;
      for (const s of this._stripes) {
        s.position.x += stripeMove;
        if (s.position.x > this.length / 2) s.position.x -= this.length;
        if (s.position.x < -this.length / 2) s.position.x += this.length;
      }
    }

    const half = this.length / 2;
    const moved = this.dir.clone().multiplyScalar(this.speed * dt);
    for (const b of this.physics.bodies) {
      if (b.attachedTo !== this) continue;
      b.mesh.position.add(moved);
      const rel = b.mesh.position.clone().sub(this.center);
      const along = rel.dot(this.dir);
      if (along > half - 0.04) {

        b.attachedTo = null;
        b.vel.copy(this.dir).multiplyScalar(this.speed);
      }
    }

    let headFree = true;
    const startWorld = this._startWorld();
    for (const b of this.physics.bodies) {
      if (b.attachedTo !== this) continue;
      if (b.mesh.position.distanceTo(startWorld) < this.spacing * 0.8) {
        headFree = false; break;
      }
    }
    if (headFree) this.spawnBlock();
  }
}
