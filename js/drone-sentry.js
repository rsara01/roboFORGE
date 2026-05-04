// Sentry-gun easter egg. When equipped, the orbit camera is replaced by a
// fixed first-person view from the sentry's barrel, with a crosshair overlay.
// Mouse aims (yaw/pitch); left-click fires a hit-scan ray that damages the
// drone if the ray passes within hitRadius of the drone's position.

import * as THREE from 'three';
import { Sound } from './sound.js';

export class Sentry {
  constructor({ scene, renderer, camera, orbit, target }) {
    this.scene = scene;
    this.renderer = renderer;
    this.simCamera = camera;
    this.orbit = orbit;
    this.target = target;        // function returning the drone's position vec3
    this.dronePhysics = null;    // injected later

    this.equipped = false;
    this.yaw = 0;
    this.pitch = 0.18;
    this.position = new THREE.Vector3(0, 0.6, 6);

    this._buildVisual();
    this._buildCamera();
    this._buildOverlay();

    this._mouseMove = this._mouseMove.bind(this);
    this._mouseDown = this._mouseDown.bind(this);
    this._pointerLockChange = this._pointerLockChange.bind(this);
    document.addEventListener('pointerlockchange', this._pointerLockChange);
  }

  _buildVisual() {
    const grp = new THREE.Group();
    grp.name = 'sentry';
    grp.position.copy(this.position);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.30, 0.36, 0.14, 16),
      new THREE.MeshStandardMaterial({ color: 0x2c3340, roughness: 0.6, metalness: 0.4 }),
    );
    base.position.y = 0.07;
    grp.add(base);

    const turret = new THREE.Group();
    turret.position.y = 0.18;
    grp.add(turret);

    const yokeMat = new THREE.MeshStandardMaterial({ color: 0x394150, roughness: 0.5, metalness: 0.5 });
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.10), yokeMat);
    turret.add(yoke);

    const gun = new THREE.Group();
    turret.add(gun);

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.7, 16),
      new THREE.MeshStandardMaterial({ color: 0x1f242c, roughness: 0.4, metalness: 0.7 }),
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.28;
    gun.add(barrel);

    const muzzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.06, 16),
      new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.4, metalness: 0.7 }),
    );
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.z = 0.62;
    gun.add(muzzle);

    this.scene.add(grp);
    this.group = grp;
    this.turret = turret;
    this.gun = gun;
  }

  _buildCamera() {
    this.camera = new THREE.PerspectiveCamera(
      55,
      this.renderer.domElement.clientWidth / this.renderer.domElement.clientHeight,
      0.05, 2000,
    );
  }

  _buildOverlay() {
    const root = document.createElement('div');
    root.id = 'sentry-overlay';
    root.style.cssText = `
      position: absolute; inset: 0; pointer-events: none; z-index: 5;
      display: none;
    `;
    root.innerHTML = `
      <div style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:60px; height:60px;">
        <div style="position:absolute; left:50%; top:0;    width:2px; height:18px; background:#76ff03; transform:translateX(-50%);"></div>
        <div style="position:absolute; left:50%; bottom:0; width:2px; height:18px; background:#76ff03; transform:translateX(-50%);"></div>
        <div style="position:absolute; top:50%; left:0;    height:2px; width:18px; background:#76ff03; transform:translateY(-50%);"></div>
        <div style="position:absolute; top:50%; right:0;   height:2px; width:18px; background:#76ff03; transform:translateY(-50%);"></div>
        <div style="position:absolute; left:50%; top:50%; width:6px; height:6px; border:1px solid #76ff03; border-radius:50%; transform:translate(-50%,-50%);"></div>
      </div>
      <div id="sentry-hud" style="position:absolute; bottom:16px; left:16px; color:#76ff03; font-family:monospace; font-size:12px; background:rgba(0,0,0,0.4); padding:6px 10px; border-radius:4px;">
        SENTRY ARMED &middot; left-click to fire &middot; ESC to release mouse &middot; press G to unequip
      </div>
    `;
    this.renderer.domElement.parentElement.appendChild(root);
    this.overlay = root;
  }

  setDronePhysics(p) { this.dronePhysics = p; }

  equip() {
    if (this.equipped) return;
    this.equipped = true;
    this.overlay.style.display = 'block';
    this.orbit.enabled = false;
    this.renderer.domElement.requestPointerLock?.();
    document.addEventListener('mousemove', this._mouseMove);
    document.addEventListener('mousedown', this._mouseDown);
    Sound.beep();
  }

  unequip() {
    if (!this.equipped) return;
    this.equipped = false;
    this.overlay.style.display = 'none';
    this.orbit.enabled = true;
    document.exitPointerLock?.();
    document.removeEventListener('mousemove', this._mouseMove);
    document.removeEventListener('mousedown', this._mouseDown);
  }

  toggle() { this.equipped ? this.unequip() : this.equip(); }

  _pointerLockChange() {
    // If the user pressed ESC, drop equipped state but keep the visual sentry
    // so they can re-equip without being thrown back to the dashboard.
    if (document.pointerLockElement !== this.renderer.domElement && this.equipped) {
      this.unequip();
    }
  }

  _mouseMove(e) {
    if (!this.equipped) return;
    const sens = 0.0025;
    this.yaw   -= e.movementX * sens;
    this.pitch -= e.movementY * sens;
    const lim = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  _mouseDown(e) {
    if (!this.equipped || e.button !== 0) return;
    this.fire();
  }

  fire() {
    Sound.shot();
    const muzzlePos = new THREE.Vector3();
    this.gun.updateWorldMatrix(true, false);
    muzzlePos.setFromMatrixPosition(this.gun.matrixWorld);
    // The gun's local +Z is forward (matches the barrel).
    const forward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(this.gun.getWorldQuaternion(new THREE.Quaternion()));

    // Tracer flash.
    this._flashTracer(muzzlePos, forward);

    if (!this.dronePhysics || this.dronePhysics.wrecked) return;
    const droneP = this.dronePhysics.position.clone();
    const toDrone = droneP.clone().sub(muzzlePos);
    const dist = toDrone.length();
    if (dist < 0.01) return;
    // Project drone onto ray, get perpendicular distance.
    const t = toDrone.dot(forward);
    if (t < 0) return;       // behind
    const closest = muzzlePos.clone().addScaledVector(forward, t);
    const miss = closest.distanceTo(droneP);
    const hitRadius = 0.30;  // generous — drone is small at distance
    if (miss < hitRadius && dist < 200) {
      const hitDir = forward.clone();
      this.dronePhysics.damage(35, hitDir);
      Sound.thud();
    }
  }

  _flashTracer(from, dir) {
    const end = from.clone().addScaledVector(dir, 80);
    const geo = new THREE.BufferGeometry().setFromPoints([from, end]);
    const mat = new THREE.LineBasicMaterial({ color: 0xfff19a, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    const start = performance.now();
    const tick = () => {
      const u = (performance.now() - start) / 200;
      if (u >= 1) { this.scene.remove(line); geo.dispose(); mat.dispose(); return; }
      mat.opacity = 0.9 * (1 - u);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Called every frame to update the turret rotation, the camera, and to
  // keep the gun pointed where the user is aiming.
  step(dt) {
    this.turret.rotation.y = this.yaw;
    this.gun.rotation.x = -this.pitch;

    if (this.equipped) {
      // First-person camera at the muzzle, looking along +Z of the gun.
      this.gun.updateWorldMatrix(true, false);
      const camPos = new THREE.Vector3(0, 0.06, 0.18).applyMatrix4(this.gun.matrixWorld);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.gun.getWorldQuaternion(new THREE.Quaternion()));
      this.camera.position.copy(camPos);
      this.camera.lookAt(camPos.clone().add(fwd));
    }
  }
}
