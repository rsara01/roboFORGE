/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║ RoboForge - Robot Definition & Control                      ║
 * ║ Created by: Rishik Saravanan                                ║
 * ║ Birthday: May 25th                                          ║
 * ║ © 2024-2026. All rights reserved.                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import * as THREE from 'three';

export const AXIS_VECTOR = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

export const LINK_AXES = ['+y', '-y', '+x', '-x', '+z', '-z'];
export const LINK_AXIS_VECTOR = {
  '+y': new THREE.Vector3( 0,  1,  0),
  '-y': new THREE.Vector3( 0, -1,  0),
  '+x': new THREE.Vector3( 1,  0,  0),
  '-x': new THREE.Vector3(-1,  0,  0),
  '+z': new THREE.Vector3( 0,  0,  1),
  '-z': new THREE.Vector3( 0,  0, -1),
};

const LINK_AXIS_QUAT = (() => {
  const q = {};
  const tmp = new THREE.Vector3(0, 1, 0);
  for (const k of LINK_AXES) {
    q[k] = new THREE.Quaternion().setFromUnitVectors(tmp, LINK_AXIS_VECTOR[k]);
  }
  return q;
})();

export const DEFAULT_COLORS = {
  revolute:     0x4ea1ff,
  revoluteDark: 0x1f4a7a,
  prismatic:    0xffae42,
  prismaticDark:0x8a5a1d,
  link:         0xc9d4e0,
  linkDark:     0x6a7686,
  base:         0x556677,
  baseDark:     0x2c3744,
  bolt:         0x2a2f36,
};

let _idCounter = 1;
const _floorTmp = new THREE.Vector3();

export class Robot {
  constructor(scene) {
    this.scene = scene;
    this.joints = [];
    this.endEffectors = [];
    this.showAxes = true;
    this.colors = { ...DEFAULT_COLORS };
    this.floorClearance = true;
    this.floorY = 0.005;
    this.selfCollision = true;

    this.selfCollisionSlack = -0.01;

    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'robot-root';
    scene.add(this.rootGroup);

    this._buildBase();
  }

  _snapshotJointValues() {
    return this.joints.map(j => j.value);
  }

  _restoreJointValues(snapshot) {
    for (let i = 0; i < this.joints.length && i < snapshot.length; i++) {
      this.joints[i].value = snapshot[i];
      this._applyJointTransform(this.joints[i]);
    }
  }

  checkFloorClearance() {
    for (const j of this.joints) {
      j.tip.updateWorldMatrix(true, false);
      _floorTmp.setFromMatrixPosition(j.tip.matrixWorld);
      if (_floorTmp.y < this.floorY) return true;
    }
    for (const ee of this.endEffectors) {
      ee.tip.updateWorldMatrix(true, false);
      _floorTmp.setFromMatrixPosition(ee.tip.matrixWorld);
      if (_floorTmp.y < this.floorY) return true;
    }
    return false;
  }

  checkSelfCollision() {
    const n = this.joints.length;
    if (n < 3) return false;
    const segs = [];
    for (const j of this.joints) {
      j.articulator.updateWorldMatrix(true, false);
      j.tip.updateWorldMatrix(true, false);
      const a = new THREE.Vector3().setFromMatrixPosition(j.articulator.matrixWorld);
      const b = new THREE.Vector3().setFromMatrixPosition(j.tip.matrixWorld);
      segs.push({ a, b, r: j.link.radius });
    }
    for (let i = 0; i < n; i++) {
      for (let k = i + 2; k < n; k++) {
        const sa = segs[i], sb = segs[k];
        const minD = sa.r + sb.r + this.selfCollisionSlack;
        if (minD <= 0) continue;
        const dSq = _segSegDistanceSq(sa.a, sa.b, sb.a, sb.b);
        if (dSq < minD * minD) return true;
      }
    }
    return false;
  }

  _hasViolation() {
    if (this.floorClearance && this.checkFloorClearance()) return true;
    if (this.selfCollision && this.checkSelfCollision()) return true;
    return false;
  }

  get endEffector() {
    return this.endEffectors[0] || null;
  }

  _tagMat(mat, key) {
    mat.userData = { ...(mat.userData || {}), colorKey: key };
    return mat;
  }

_buildBase() {
    const baseGroup = new THREE.Group();
    baseGroup.name = 'robot-base';

    const padGeo = new THREE.CylinderGeometry(0.30, 0.32, 0.025, 48);
    const padMat = this._tagMat(new THREE.MeshStandardMaterial({ color: this.colors.baseDark, roughness: 0.7, metalness: 0.3 }), 'baseDark');
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = 0.0125;
    pad.castShadow = pad.receiveShadow = true;
    baseGroup.add(pad);

    const boltGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.015, 12);
    const boltMat = this._tagMat(new THREE.MeshStandardMaterial({ color: this.colors.bolt, roughness: 0.4, metalness: 0.8 }), 'bolt');
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const b = new THREE.Mesh(boltGeo, boltMat);
      b.position.set(Math.cos(a) * 0.265, 0.028, Math.sin(a) * 0.265);
      b.castShadow = true;
      baseGroup.add(b);
    }

    const pedGeo = new THREE.CylinderGeometry(0.18, 0.24, 0.14, 32);
    const pedMat = this._tagMat(new THREE.MeshStandardMaterial({ color: this.colors.base, roughness: 0.45, metalness: 0.5 }), 'base');
    const pedestal = new THREE.Mesh(pedGeo, pedMat);
    pedestal.position.y = 0.025 + 0.07;
    pedestal.castShadow = pedestal.receiveShadow = true;
    baseGroup.add(pedestal);

    const flangeGeo = new THREE.CylinderGeometry(0.20, 0.20, 0.025, 32);
    const flangeMat = this._tagMat(new THREE.MeshStandardMaterial({ color: this.colors.baseDark, roughness: 0.4, metalness: 0.6 }), 'baseDark');
    const flange = new THREE.Mesh(flangeGeo, flangeMat);
    flange.position.y = 0.025 + 0.14 + 0.0125;
    flange.castShadow = flange.receiveShadow = true;
    baseGroup.add(flange);

    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const b = new THREE.Mesh(boltGeo, boltMat);
      b.position.set(Math.cos(a) * 0.165, 0.025 + 0.14 + 0.022, Math.sin(a) * 0.165);
      b.castShadow = true;
      baseGroup.add(b);
    }

    const boxGeo = new THREE.BoxGeometry(0.18, 0.10, 0.10);
    const boxMat = this._tagMat(new THREE.MeshStandardMaterial({ color: 0x2c3340, roughness: 0.5, metalness: 0.4 }), 'baseDark');
    const ctrlBox = new THREE.Mesh(boxGeo, boxMat);
    ctrlBox.position.set(-0.30, 0.07, 0);
    ctrlBox.castShadow = ctrlBox.receiveShadow = true;
    baseGroup.add(ctrlBox);

    this.baseMesh = pedestal;
    this.baseGroup = baseGroup;
    this.rootGroup.add(baseGroup);

    this.baseTip = new THREE.Object3D();
    this.baseTip.name = 'base-tip';
    this.baseTip.position.y = 0.025 + 0.14 + 0.025;
    this.rootGroup.add(this.baseTip);
  }

_buildRevoluteHousing(j) {
    const grp = new THREE.Group();
    grp.name = `${j.name}-housing`;

    const r = 0.075, len = 0.12;
    const bodyMat = this._tagMat(new THREE.MeshStandardMaterial({ color: this.colors.revolute, roughness: 0.35, metalness: 0.55 }), 'revolute');
    const darkMat = this._tagMat(new THREE.MeshStandardMaterial({ color: this.colors.revoluteDark, roughness: 0.45, metalness: 0.6 }), 'revoluteDark');
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.5, metalness: 0.7 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 32), bodyMat);
    body.castShadow = body.receiveShadow = true;
    body.userData.jointId = j.id;
    grp.add(body);

    const capGeo = new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.018, 32);
    const capTop = new THREE.Mesh(capGeo, darkMat);
    capTop.position.y = len / 2 + 0.009;
    capTop.castShadow = capTop.receiveShadow = true;
    grp.add(capTop);
    const capBot = new THREE.Mesh(capGeo, darkMat);
    capBot.position.y = -(len / 2 + 0.009);
    capBot.castShadow = capBot.receiveShadow = true;
    grp.add(capBot);

    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.012, 32), ringMat);
    grp.add(ring);

    const bolt = this._tagMat(new THREE.MeshStandardMaterial({ color: this.colors.bolt, roughness: 0.4, metalness: 0.8 }), 'bolt');
    const boltGeo = new THREE.CylinderGeometry(0.0075, 0.0075, 0.022, 8);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const b = new THREE.Mesh(boltGeo, bolt);
      b.position.set(Math.cos(a) * r * 0.85, len / 2 + 0.018, Math.sin(a) * r * 0.85);
      b.castShadow = true;
      grp.add(b);
    }

    if (j.axis === 'x') grp.rotation.z = Math.PI / 2;
    else if (j.axis === 'z') grp.rotation.x = Math.PI / 2;

    j.jointMesh = body;
    j.housing = grp;
    return grp;
  }

_buildPrismaticHousing(j) {

    const grp = new THREE.Group();
    grp.name = `${j.name}-housing`;

    const bodyMat   = this._tagMat(new THREE.MeshStandardMaterial({ color: this.colors.prismatic,     roughness: 0.4, metalness: 0.55 }), 'prismatic');
    const darkMat   = this._tagMat(new THREE.MeshStandardMaterial({ color: this.colors.prismaticDark, roughness: 0.5, metalness: 0.6  }), 'prismaticDark');

    const barrelLen = 0.16;
    const barrelR   = 0.045;

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(barrelR, barrelR, barrelLen, 24), bodyMat);
    barrel.castShadow = barrel.receiveShadow = true;
    barrel.userData.jointId = j.id;
    grp.add(barrel);

    const capGeo = new THREE.CylinderGeometry(barrelR * 1.18, barrelR * 1.18, 0.018, 24);
    const capTop = new THREE.Mesh(capGeo, darkMat);
    capTop.position.y =  barrelLen / 2 + 0.009;
    capTop.castShadow = capTop.receiveShadow = true;
    grp.add(capTop);
    const capBot = new THREE.Mesh(capGeo, darkMat);
    capBot.position.y = -(barrelLen / 2 + 0.009);
    capBot.castShadow = capBot.receiveShadow = true;
    grp.add(capBot);

    const flange = new THREE.Mesh(
      new THREE.CylinderGeometry(barrelR * 1.55, barrelR * 1.55, 0.014, 24),
      darkMat
    );
    flange.position.y = -(barrelLen / 2 + 0.025);
    flange.castShadow = flange.receiveShadow = true;
    grp.add(flange);

    const ribMat = darkMat;
    const ribGeo = new THREE.BoxGeometry(barrelR * 2.2, 0.012, 0.014);
    for (const yOffset of [-0.03, 0.03]) {
      const rib = new THREE.Mesh(ribGeo, ribMat);
      rib.position.y = yOffset;
      grp.add(rib);
    }

    if (j.axis === 'x') grp.rotation.z = Math.PI / 2;
    else if (j.axis === 'z') grp.rotation.x = Math.PI / 2;

    j.jointMesh = barrel;
    j.housing = grp;
    j._barrelLen = barrelLen;
    j._barrelR   = barrelR;
    return grp;
  }

  _buildPrismaticRod(j) {
    const grp = new THREE.Group();
    grp.name = `${j.name}-rod`;

    const rodMat = this._tagMat(new THREE.MeshStandardMaterial({ color: 0xdcdcdc, roughness: 0.2, metalness: 0.9 }), null);
    const headMat = this._tagMat(new THREE.MeshStandardMaterial({ color: this.colors.prismaticDark, roughness: 0.45, metalness: 0.6 }), 'prismaticDark');

    const rodLen = (j._barrelLen || 0.16) * 1.4;
    const rodR   = (j._barrelR   || 0.045) * 0.4;

    const rod = new THREE.Mesh(new THREE.CylinderGeometry(rodR, rodR, rodLen, 16), rodMat);
    rod.castShadow = rod.receiveShadow = true;
    grp.add(rod);

    const head = new THREE.Mesh(new THREE.CylinderGeometry(rodR * 1.8, rodR * 1.8, 0.022, 18), headMat);
    head.castShadow = true;

    const a = AXIS_VECTOR[j.axis] || AXIS_VECTOR.y;
    head.position.set(a.x * (rodLen / 2 + 0.011), a.y * (rodLen / 2 + 0.011), a.z * (rodLen / 2 + 0.011));
    grp.add(head);

    if (j.axis === 'x') {
      rod.rotation.z = Math.PI / 2;
      head.position.set((rodLen / 2 + 0.011), 0, 0);
    } else if (j.axis === 'z') {
      rod.rotation.x = Math.PI / 2;
      head.position.set(0, 0, (rodLen / 2 + 0.011));
    }

    j.rodGroup = grp;
    return grp;
  }

_buildLinkVisual(j) {
    const grp = new THREE.Group();
    grp.name = `${j.name}-link`;

    const len = j.link.length;
    const r = j.link.radius;

    const tubeMat = this._tagMat(new THREE.MeshStandardMaterial({ color: j.link.color ?? this.colors.link, roughness: 0.4, metalness: 0.55 }), j.link.color != null ? null : 'link');
    const darkMat = this._tagMat(new THREE.MeshStandardMaterial({ color: this.colors.linkDark, roughness: 0.5, metalness: 0.45 }), 'linkDark');
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x1a1f28, roughness: 0.6, metalness: 0.3 });

    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.85, r, len, 22),
      tubeMat
    );
    tube.position.y = len / 2;
    tube.castShadow = tube.receiveShadow = true;
    tube.userData.jointId = j.id;
    tube.userData.isLink = true;
    grp.add(tube);

    const flangeBot = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.022, 24),
      darkMat
    );
    flangeBot.position.y = 0.011;
    flangeBot.castShadow = flangeBot.receiveShadow = true;
    grp.add(flangeBot);

    const flangeTop = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.18, r * 1.18, 0.020, 24),
      darkMat
    );
    flangeTop.position.y = len - 0.010;
    flangeTop.castShadow = flangeTop.receiveShadow = true;
    grp.add(flangeTop);

    if (len > 0.12) {
      const stripe = new THREE.Mesh(
        new THREE.TorusGeometry(r * 0.92, r * 0.08, 8, 24),
        stripeMat
      );
      stripe.rotation.x = Math.PI / 2;
      stripe.position.y = len * 0.5;
      grp.add(stripe);
    }

    const axisName = j.link.axis || '+y';
    grp.quaternion.copy(LINK_AXIS_QUAT[axisName] || LINK_AXIS_QUAT['+y']);

    j.linkMesh = tube;
    j.linkGroup = grp;
    return grp;
  }

  setColor(key, hex) {
    if (!(key in this.colors)) return;
    this.colors[key] = hex;
    this.rootGroup.traverse(o => {
      if (!o.isMesh) return;
      const mat = o.material;
      if (Array.isArray(mat)) {
        for (const m of mat) if (m.userData?.colorKey === key) m.color.setHex(hex);
      } else if (mat?.userData?.colorKey === key) {
        mat.color.setHex(hex);
      }
    });
  }

  resetColors() {
    for (const k of Object.keys(DEFAULT_COLORS)) this.setColor(k, DEFAULT_COLORS[k]);
  }

addJoint(opts = {}) {
    if (this.joints.length >= 6) {
      console.warn('Already at 6-DOF cap');
      return null;
    }
    const type = opts.type || 'revolute';
    const axis = opts.axis || (type === 'prismatic' ? 'z' : (this.joints.length % 2 === 0 ? 'y' : 'x'));
    const linkLength = opts.linkLength ?? 0.3;
    const linkRadius = opts.linkRadius ?? 0.05;

    const linkAxis = LINK_AXES.includes(opts.linkAxis) ? opts.linkAxis : '+y';
    const j = {
      id: _idCounter++,
      name: `${type === 'revolute' ? 'J' : 'P'}${this.joints.length + 1}`,
      type, axis,
      value: 0,
      min: opts.min ?? (type === 'revolute' ? -Math.PI : -0.4),
      max: opts.max ?? (type === 'revolute' ? Math.PI : 0.4),
      link: {
        length: linkLength,
        radius: linkRadius,
        color: opts.linkColor ?? null,
        axis: linkAxis,
      },
    };

    j.group = new THREE.Group();
    j.group.name = `${j.name}-anchor`;

    const housing = (type === 'revolute')
      ? this._buildRevoluteHousing(j)
      : this._buildPrismaticHousing(j);
    j.group.add(housing);

    j.articulator = new THREE.Group();
    j.articulator.name = `${j.name}-articulator`;
    j.group.add(j.articulator);

    if (type === 'prismatic') {
      j.articulator.add(this._buildPrismaticRod(j));
    }

    const linkGrp = this._buildLinkVisual(j);
    j.articulator.add(linkGrp);

    j.tip = new THREE.Object3D();
    j.tip.name = `${j.name}-tip`;
    const tipDir = LINK_AXIS_VECTOR[linkAxis] || LINK_AXIS_VECTOR['+y'];
    j.tip.position.copy(tipDir).multiplyScalar(linkLength);
    j.articulator.add(j.tip);

    j.axesHelper = new THREE.AxesHelper(0.13);
    j.axesHelper.visible = this.showAxes;
    j.group.add(j.axesHelper);

    const parentTip = this.joints.length === 0 ? this.baseTip : this.joints[this.joints.length - 1].tip;
    parentTip.add(j.group);

    this.joints.push(j);
    this._applyJointTransform(j);
    return j;
  }

  removeLastJoint() {
    if (this.joints.length === 0) return;
    const j = this.joints.pop();
    const detached = [];
    for (const ee of this.endEffectors) {
      if (ee.parentJoint === j) detached.push(ee);
    }
    for (const ee of detached) this._reparentEEToTip(ee);
    j.group.parent.remove(j.group);
    this._disposeJoint(j);
    this._restackEndEffectors();
  }

  _reparentEEToTip(ee) {
    const newTip = this.joints.length === 0 ? this.baseTip : this.joints[this.joints.length - 1].tip;
    if (ee.group.parent) ee.group.parent.remove(ee.group);
    newTip.add(ee.group);
    ee.parentJoint = this.joints[this.joints.length - 1] || null;
  }

  removeJoint(id) {
    const idx = this.joints.findIndex(j => j.id === id);
    if (idx < 0) return;
    while (this.joints.length > idx) this.removeLastJoint();
  }

  clear() {
    while (this.joints.length) this.removeLastJoint();
    this.detachAllEndEffectors();
  }

  _disposeJoint(j) {
    j.group.traverse(o => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
        else o.material?.dispose?.();
      }
    });
  }

setJointValue(index, value) {
    const j = this.joints[index];
    if (!j) return;
    const old = j.value;
    j.value = clamp(value, j.min, j.max);
    this._applyJointTransform(j);
    if (this._hasViolation()) {
      j.value = old;
      this._applyJointTransform(j);
    }
  }

  getJointValue(index) {
    return this.joints[index]?.value ?? 0;
  }

  setAllJoints(values) {
    const snap = this._snapshotJointValues();
    for (let i = 0; i < this.joints.length && i < values.length; i++) {
      const j = this.joints[i];
      j.value = clamp(values[i], j.min, j.max);
      this._applyJointTransform(j);
    }
    if (this._hasViolation()) {
      this._restoreJointValues(snap);
    }
  }

  _applyJointTransform(j) {
    const a = AXIS_VECTOR[j.axis];
    if (j.type === 'revolute') {
      j.articulator.position.set(0, 0, 0);
      j.articulator.quaternion.setFromAxisAngle(a, j.value);
    } else {
      j.articulator.quaternion.identity();
      j.articulator.position.copy(a).multiplyScalar(j.value);
    }
  }

  updateAll() {
    for (const j of this.joints) this._applyJointTransform(j);
  }

  getEndEffectorWorldPosition(target = new THREE.Vector3()) {
    const primary = this.endEffectors[0];
    const last = primary
      ? primary.tip
      : (this.joints.length ? this.joints[this.joints.length - 1].tip : this.baseTip);
    last.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(last.matrixWorld);
  }

rebuildJointGeometry(j) {
    if (j.housing) {
      j.group.remove(j.housing);
      j.housing.traverse(o => {
        if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); }
      });
    }
    if (j.linkGroup) {
      j.articulator.remove(j.linkGroup);
      j.linkGroup.traverse(o => {
        if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); }
      });
    }

    const housing = (j.type === 'revolute')
      ? this._buildRevoluteHousing(j)
      : this._buildPrismaticHousing(j);
    j.group.add(housing);

    if (j.rodGroup) {
      j.articulator.remove(j.rodGroup);
      j.rodGroup.traverse(o => {
        if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); }
      });
      j.rodGroup = null;
    }
    if (j.type === 'prismatic') {
      j.articulator.add(this._buildPrismaticRod(j));
    }

    const linkGrp = this._buildLinkVisual(j);
    j.articulator.add(linkGrp);
    const tipDir2 = LINK_AXIS_VECTOR[j.link.axis || '+y'] || LINK_AXIS_VECTOR['+y'];
    j.tip.position.copy(tipDir2).multiplyScalar(j.link.length);

    this._applyJointTransform(j);
  }

  setShowAxes(v) {
    this.showAxes = v;
    for (const j of this.joints) j.axesHelper.visible = v;
  }

  addEndEffector(eeObj) {
    if (!eeObj) return null;
    const last = this.joints.length ? this.joints[this.joints.length - 1].tip : this.baseTip;
    last.add(eeObj.group);
    eeObj.parentJoint = this.joints[this.joints.length - 1] || null;
    this.endEffectors.push(eeObj);
    this._restackEndEffectors();
    return eeObj;
  }

  attachEndEffectorGroup(eeObj) {
    this.detachAllEndEffectors();
    return this.addEndEffector(eeObj);
  }

  removeEndEffector(eeOrIndex) {
    let idx = typeof eeOrIndex === 'number'
      ? eeOrIndex
      : this.endEffectors.indexOf(eeOrIndex);
    if (idx < 0 || idx >= this.endEffectors.length) return;
    const ee = this.endEffectors.splice(idx, 1)[0];
    ee.group.parent?.remove(ee.group);
    ee.dispose?.();
    this._restackEndEffectors();
  }

  detachAllEndEffectors() {
    while (this.endEffectors.length) this.removeEndEffector(this.endEffectors.length - 1);
  }

  detachEndEffector() { this.detachAllEndEffectors(); }

  _restackEndEffectors() {

    for (let i = 0; i < this.endEffectors.length; i++) {
      const ee = this.endEffectors[i];
      const offset = i === 0 ? 0 : 0.07 + (i - 1) * 0.07;
      const angle = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.PI * 0.5;
      ee.group.position.x = Math.cos(angle) * offset;
      ee.group.position.z = Math.sin(angle) * offset;
    }
  }

jointFromObject(obj) {
    let cur = obj;
    while (cur) {
      if (cur.userData && cur.userData.jointId) {
        return this.joints.find(j => j.id === cur.userData.jointId) || null;
      }
      cur = cur.parent;
    }
    return null;
  }

  pickableObjects() {
    const arr = [];
    for (const j of this.joints) {
      if (j.jointMesh) arr.push(j.jointMesh);
      if (j.linkMesh) arr.push(j.linkMesh);
    }
    for (const ee of this.endEffectors) {
      if (ee.pickables) arr.push(...ee.pickables);
    }
    return arr;
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

const _ssD1 = new THREE.Vector3();
const _ssD2 = new THREE.Vector3();
const _ssR  = new THREE.Vector3();
const _ssCp1 = new THREE.Vector3();
const _ssCp2 = new THREE.Vector3();
function _segSegDistanceSq(a0, a1, b0, b1) {
  _ssD1.subVectors(a1, a0);
  _ssD2.subVectors(b1, b0);
  _ssR.subVectors(a0, b0);
  const a = _ssD1.dot(_ssD1);
  const e = _ssD2.dot(_ssD2);
  const f = _ssD2.dot(_ssR);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) return a0.distanceToSquared(b0);
  if (a <= 1e-9) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = _ssD1.dot(_ssR);
    if (e <= 1e-9) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = _ssD1.dot(_ssD2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  _ssCp1.copy(_ssD1).multiplyScalar(s).add(a0);
  _ssCp2.copy(_ssD2).multiplyScalar(t).add(b0);
  return _ssCp1.distanceToSquared(_ssCp2);
}
