

import * as THREE from 'three';

const FEED_W = 240;
const FEED_H = 160;

export class CameraFeed {
  constructor(scene, getActiveCameraEE, opts = {}) {
    this.scene = scene;
    this.getActiveCameraEE = getActiveCameraEE;
    this.physics = opts.physics || null;

    this.cam = new THREE.PerspectiveCamera(60, FEED_W / FEED_H, 0.02, 20);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(FEED_W, FEED_H, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const wrap = document.createElement('div');
    wrap.id = 'camera-feed';
    wrap.className = 'camera-feed hidden';
    wrap.innerHTML = `
      <div class="cf-label">Camera feed</div>
      <div class="cf-canvas"></div>
      <div class="cf-detect">No camera mounted.</div>
    `;
    wrap.querySelector('.cf-canvas').appendChild(this.renderer.domElement);
    this.dom = wrap;
    this.detectEl = wrap.querySelector('.cf-detect');

    this._tickAccum = 0;
  }

  attachTo(parent) {
    parent.appendChild(this.dom);
  }

  setVisible(v) {
    this.dom.classList.toggle('hidden', !v);
  }

  step(dt) {
    this._tickAccum += dt;
    if (this._tickAccum < 1 / 24) return;
    this._tickAccum = 0;

    const ee = this.getActiveCameraEE();
    if (!ee || !ee.tip) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);

    ee.tip.updateWorldMatrix(true, false);
    const tipPos = new THREE.Vector3().setFromMatrixPosition(ee.tip.matrixWorld);
    const tipQuat = new THREE.Quaternion().setFromRotationMatrix(ee.tip.matrixWorld);

    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(tipQuat);
    const up  = new THREE.Vector3(0, 1, 0).applyQuaternion(tipQuat);
    this.cam.position.copy(tipPos);
    this.cam.up.copy(up);
    this.cam.lookAt(tipPos.clone().add(fwd));

    this.renderer.render(this.scene, this.cam);
    this._updateDetectLabel(tipPos, fwd);
  }

  _updateDetectLabel(tipPos, fwd) {
    if (!this.physics) { this.detectEl.textContent = '—'; return; }
    let closest = null;
    let bestD = Infinity;
    const wp = new THREE.Vector3();
    for (const b of this.physics.bodies) {

      if (b.attachedTo && !(b.attachedTo.constructor && b.attachedTo.constructor.name === 'Conveyor')
                       && !b.attachedTo.isObject3D ) {

      }
      if (b.attachedTo && b.attachedTo.isObject3D) continue;
      wp.setFromMatrixPosition(b.mesh.matrixWorld);
      const dir = wp.clone().sub(tipPos);
      const dist = dir.length();
      if (dist < 0.05 || dist > 3.5) continue;
      dir.divideScalar(dist);
      const ang = Math.acos(THREE.MathUtils.clamp(dir.dot(fwd), -1, 1));
      if (ang > Math.PI / 4) continue;
      if (dist < bestD) { bestD = dist; closest = b; }
    }
    if (!closest) {
      this.detectEl.innerHTML = '<span class="cf-empty">Nothing in view.</span>';
      return;
    }
    const col = closest.mesh.material.color;
    const colName = _colorName(col.r, col.g, col.b);
    const shape = closest.shape || _inferShape(closest.mesh.geometry);
    const hex = '#' + col.getHex().toString(16).padStart(6, '0');
    this.detectEl.innerHTML = `<span class="cf-sw" style="background:${hex}"></span>
      <span class="cf-color">${colName}</span> <span class="cf-shape">${shape}</span>
      <span class="cf-dist">${bestD.toFixed(2)} m</span>`;
  }
}

function _colorName(r, g, b) {
  if (r > 0.85 && g > 0.85 && b > 0.85) return 'white';
  if (r < 0.15 && g < 0.15 && b < 0.15) return 'black';
  if (r > 0.6 && g > 0.5 && b < 0.4) return r - b > 0.4 ? 'orange' : 'yellow';
  if (r > 0.6 && g < 0.5 && b < 0.5) return 'red';
  if (g > 0.55 && r < 0.7 && b < 0.6) return 'green';
  if (b > 0.55 && r < 0.6) return 'blue';
  if (r > 0.5 && b > 0.5 && g < 0.55) return 'magenta';
  return 'mixed';
}

function _inferShape(geo) {
  if (!geo) return 'unknown';
  const t = geo.type || '';
  if (t.includes('Box')) return 'cube';
  if (t.includes('Cylinder')) return 'cylinder';
  if (t.includes('Cone')) return 'pyramid';
  if (t.includes('Sphere')) return 'sphere';
  return 'shape';
}
