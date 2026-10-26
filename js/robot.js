/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║ RoboForge - Robot Definition & Control                      ║
 * ║ Created by: Rishik Saravanan                                ║
 * ║ Birthday: May 25th                                          ║
 * ║ © 2024-2026. All rights reserved.                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import * as THREE from 'three';
import { MeshLibrary } from './meshLibrary.js';

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
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.joints = [];
    this.endEffectors = [];
    this.showAxes = true;
    this.colors = { ...DEFAULT_COLORS };
    this.floorClearance = true;
    this.floorY = 0.005;
    this.selfCollision = true;

    this.selfCollisionSlack = -0.01;

    // Which geometry set dresses the kinematic chain: 'procedural' (built-in
    // primitives) or a MeshLibrary set id such as 'RS' (real CAD). CAD geometry
    // must be preloaded via MeshLibrary.load() BEFORE construction so that the
    // synchronous builders can pull it; otherwise we degrade to procedural.
    this.meshSet = opts.meshSet || 'procedural';

    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'robot-root';
    scene.add(this.rootGroup);

    this._buildBase();
  }

  /** True when a CAD mesh set is active and loaded for this robot. */
  _cadActive() {
    return this.meshSet && this.meshSet !== 'procedural' && MeshLibrary.isLoaded(this.meshSet);
  }

  /** Acquire the shared CAD parts [{geometry, colorKey}] for a link id, or null. */
  _cadParts(id) {
    if (!this._cadActive() || !id) return null;
    return MeshLibrary.acquireLinkParts(this.meshSet, id);
  }

  /** Non-owning check: is a CAD mesh available for this link id? */
  _cadGeometryAvailable(id) {
    if (!this._cadActive() || !id) return false;
    return MeshLibrary.hasLink(this.meshSet, id);
  }

  /**
   * Build a tagged, shadowed mesh from a shared CAD geometry. The geometry is
   * owned by MeshLibrary (userData.sharedGeometry flags it so teardown never
   * disposes it). PBR values mirror the procedural structural parts so the CAD
   * arm reads as the same product under the identical scene lighting.
   */
  _cadMesh(geometry, colorKey, jointId, isLink) {
    const base = this.colors[colorKey] ?? DEFAULT_COLORS[colorKey] ?? 0xc9d4e0;
    const mat = this._tagMat(new THREE.MeshStandardMaterial({
      color: base, roughness: 0.42, metalness: 0.55,
    }), colorKey);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.sharedGeometry = true;
    if (jointId != null) mesh.userData.jointId = jointId;
    if (isLink) mesh.userData.isLink = true;
    return mesh;
  }

  /** Tagged mesh from geometry this Robot OWNS (procedural — safe to dispose). */
  _procMesh(geometry, colorKey, jointId) {
    const base = this.colors[colorKey] ?? DEFAULT_COLORS[colorKey] ?? 0xc9d4e0;
    const mat = this._tagMat(new THREE.MeshStandardMaterial({
      color: base, roughness: 0.42, metalness: 0.55,
    }), colorKey);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    if (jointId != null) mesh.userData.jointId = jointId;
    mesh.userData.isLink = true;
    return mesh;
  }

  /**
   * Thin shell sleeves for the RS gripper. Its guide rail and drive racks run out
   * to ±92 mm while the jaw bodies only reach ~±53 mm, so those bare ends stick
   * into empty space and read as hanging geometry. Each sleeve is a thin closed
   * box hugging the measured 30 x 38 mm protruding cross-section, so the rail and
   * racks disappear into a housing instead of dangling. Cosmetic and static; the
   * racks simply slide inside it.
   */
  _buildGripperShell(j) {
    const shell = new THREE.Group();
    shell.name = `${j.name}-shell`;
    const X_LEN = 0.034, X_MID = -0.0555;   // measured protruding cross-section
    const H = 0.044, T = 0.002;             // sleeve height / wall thickness
    const Z_IN = 0.050, Z_OUT = 0.095;      // clear of the jaw bodies, out past the rail tip
    const zLen = Z_OUT - Z_IN, zMid = (Z_OUT + Z_IN) / 2;
    for (const s of [1, -1]) {
      const panels = [
        [new THREE.BoxGeometry(X_LEN, T, zLen), [X_MID,  (H - T) / 2, s * zMid]],  // top
        [new THREE.BoxGeometry(X_LEN, T, zLen), [X_MID, -(H - T) / 2, s * zMid]],  // bottom
        [new THREE.BoxGeometry(T, H, zLen), [X_MID + (X_LEN - T) / 2, 0, s * zMid]], // +x
        [new THREE.BoxGeometry(T, H, zLen), [X_MID - (X_LEN - T) / 2, 0, s * zMid]], // -x
        [new THREE.BoxGeometry(X_LEN, H, T), [X_MID, 0, s * (Z_OUT - T / 2)]],     // end cap
      ];
      for (const [geo, pos] of panels) {
        const m = this._procMesh(geo, 'linkDark', j.id);
        m.position.set(pos[0], pos[1], pos[2]);
        shell.add(m);
        j.partMeshes.push(m);
      }
    }
    return shell;
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
    // --- CAD base branch ------------------------------------------------
    const cadBaseParts = this._cadParts('base');
    if (cadBaseParts) {
      const baseGroup = new THREE.Group();
      baseGroup.name = 'robot-base';
      let main = null;
      for (const part of cadBaseParts) {
        const mesh = this._cadMesh(part.geometry, part.colorKey, null, false);
        baseGroup.add(mesh);
        if (!main || part.colorKey === 'base') main = mesh;
      }
      this.baseMesh = main;
      this.baseGroup = baseGroup;
      this.rootGroup.add(baseGroup);

      const entry = MeshLibrary.baseEntry(this.meshSet);
      this.baseTip = new THREE.Object3D();
      this.baseTip.name = 'base-tip';
      // Faithful build: J1's pivot is at the base's real tipOffset; older sets
      // fall back to the AABB top.
      if (Array.isArray(entry?.tipOffset)) {
        this.baseTip.position.set(entry.tipOffset[0], entry.tipOffset[1], entry.tipOffset[2]);
      } else {
        this.baseTip.position.y = entry?.aabb ? entry.aabb[4] : 0.075;
      }
      this.rootGroup.add(this.baseTip);
      return;
    }
    // --- procedural base ------------------------------------------------
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
    // CAD: the motor module (RSM stator/rotor) is part of the link sub-assembly
    // mesh, so no separate procedural housing is drawn. j.jointMesh is assigned
    // by _buildLinkVisual for CAD arms.
    if (this._cadGeometryAvailable(j.meshId)) {
      const empty = new THREE.Group();
      empty.name = `${j.name}-housing`;
      j.housing = empty;
      return empty;
    }
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

    if (this._cadGeometryAvailable(j.meshId)) {
      const empty = new THREE.Group();
      empty.name = `${j.name}-housing`;
      j.housing = empty;
      j._barrelLen = 0.16;
      j._barrelR = 0.045;
      return empty;
    }
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
    // CAD prismatic joints carry their rod in the sub-assembly mesh already.
    if (this._cadGeometryAvailable(j.meshId)) { j.rodGroup = grp; return grp; }

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
    // --- CAD link branch ------------------------------------------------
    // The whole moving sub-assembly (link structure + its motor module) is a set
    // of baked, per-colour meshes, already in the joint-local frame pointing +Y,
    // so they ride the articulator and rotate as one with the joint. The motor
    // parts are tagged 'revolute' so each joint's pivot reads as a blue module.
    const cadParts = this._cadParts(j.meshId);
    if (cadParts) {
      const grp = new THREE.Group();
      grp.name = `${j.name}-link`;
      j.partMeshes = [];
      j.fingers = { up: [], down: [] };  // the two sliding gripper jaws, if any
      let main = null, mainKey = null;
      for (const part of cadParts) {
        const mesh = this._cadMesh(part.geometry, part.colorKey, j.id, true);
        mesh.userData.rest = mesh.position.clone();
        if (part.role === 'fingerA' || part.role === 'fingerUp') j.fingers.up.push(mesh);
        else if (part.role === 'fingerB' || part.role === 'fingerDown') j.fingers.down.push(mesh);
        if (part.role === 'housing') {
          // This joint's own motor casing was baked into its own link mesh
          // instead of the parent's (see MeshLibrary.HOUSING_SPLIT_RADIUS);
          // keep it on the joint's static frame so it doesn't spin along with
          // the link it's mounted next to.
          j.housing.add(mesh);
          j.partMeshes.push(mesh);
          continue;
        }
        grp.add(mesh);
        j.partMeshes.push(mesh);
        // prefer the structural mesh as the pickable "link" representative
        if (!main || (part.colorKey === 'link' && mainKey !== 'link')) { main = mesh; mainKey = part.colorKey; }
      }
      j.linkMesh = main;
      j.jointMesh = main;
      j.linkGroup = grp;
      if (j.fingers.up.length || j.fingers.down.length) {
        this.gripperJoint = j;
        grp.add(this._buildGripperShell(j));   // close off the open mechanism bay
      }
      // Faithful CAD meshes are baked in real orientation; no linkAxis unfold.
      const axisName = j.link.axis || '+y';
      grp.quaternion.copy(LINK_AXIS_QUAT[axisName] || LINK_AXIS_QUAT['+y']);
      return grp;
    }
    // --- procedural link ------------------------------------------------
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
      meshId: opts.meshId ?? null,   // CAD link id in the active mesh set, if any
      // Faithful-CAD kinematics: an arbitrary unit rotation axis and an arbitrary
      // offset to the next joint (both in the joint's local frame). When present
      // they override the cardinal axis + linkAxis·linkLength layout, so the arm
      // keeps its real CAD shape instead of a straight +Y stack.
      axisVec: Array.isArray(opts.axisVec) ? new THREE.Vector3(opts.axisVec[0], opts.axisVec[1], opts.axisVec[2]).normalize() : null,
      tipOffset: Array.isArray(opts.tipOffset) ? new THREE.Vector3(opts.tipOffset[0], opts.tipOffset[1], opts.tipOffset[2]) : null,
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
    if (j.tipOffset) {
      j.tip.position.copy(j.tipOffset);
    } else {
      const tipDir = LINK_AXIS_VECTOR[linkAxis] || LINK_AXIS_VECTOR['+y'];
      j.tip.position.copy(tipDir).multiplyScalar(linkLength);
    }
    j.articulator.add(j.tip);

    j.axesHelper = new THREE.AxesHelper(0.13);
    j.axesHelper.visible = this.showAxes;
    j.group.add(j.axesHelper);

    const parentTip = this.joints.length === 0 ? this.baseTip : this.joints[this.joints.length - 1].tip;
    parentTip.add(j.group);

    this.joints.push(j);
    this._applyJointTransform(j);
    if (j === this.gripperJoint) this._mountOwnGripper(j);
    return j;
  }

  /**
   * The RS arm's real jaws, presented as a mounted gripper (first in line), so
   * gripper(), grab(), IK-to-the-grip-point and the Gripper slider all use them.
   * Its grip point is the middle of the space between the two jaws.
   */
  _mountOwnGripper(j) {
    const jaws = [...j.fingers.up, ...j.fingers.down];
    this.rootGroup.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    for (const m of jaws) box.expandByObject(m, true);
    const group = new THREE.Group();
    group.name = 'ee-own-gripper';
    const grasp = new THREE.Object3D();
    const tip = new THREE.Object3D();
    group.add(grasp, tip);
    const robot = this;
    const params = { open: this.gripperOpen ?? 0 };
    const ee = {
      type: 'gripper', own: true, label: 'Own gripper',
      group, tip, grasp, params, pickables: [],
      setParam(name, val) { if (name === 'open') robot.setGripperOpen(+val); },
      setHold(body) { robot._holdHalf = body ? (body.halfExtents || 0.03) : 0; robot.setGripperOpen(robot.gripperOpen); },
      update() {}, dispose() {},
    };
    this.addEndEffector(ee);
    // Put the grip point at the jaws' centre and the "tip" at their far end,
    // measured along the way the last link points.
    j.tip.updateWorldMatrix(true, false);
    group.updateWorldMatrix(true, false);
    if (!box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3());
      grasp.position.copy(group.worldToLocal(c.clone()));
      const reach = new THREE.Vector3().setFromMatrixPosition(j.tip.matrixWorld)
        .sub(new THREE.Vector3().setFromMatrixPosition(j.articulator.matrixWorld)).normalize();
      const corners = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
      const far = Math.max(...corners.map(p => p.clone().sub(c).dot(reach)));
      tip.position.copy(group.worldToLocal(c.clone().addScaledVector(reach, far)));
    }
    // Own gripper goes first so IK and grab() use it.
    this.endEffectors.splice(this.endEffectors.indexOf(ee), 1);
    this.endEffectors.unshift(ee);
    this._restackEndEffectors();
  }

  removeLastJoint() {
    if (this.joints.length === 0) return;
    if (this.joints[this.joints.length - 1] === this.gripperJoint) {
      const own = this.endEffectors.find(e => e.own);
      if (own) this.removeEndEffector(own);
      this.gripperJoint = null;
    }
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
    // Dispose meshes AND line/points objects (e.g. the joint AxesHelper), so no
    // GPU geometry leaks when joints are torn down (model switches, clear()).
    j.group.traverse(o => {
      if (o.geometry && !o.userData.sharedGeometry) o.geometry.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
      else o.material?.dispose?.();
    });
    if (j.meshId && this.meshSet && this.meshSet !== 'procedural' && !j.procGripper) {
      MeshLibrary.releaseLink(this.meshSet, j.meshId);
    }
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
    const a = j.axisVec || AXIS_VECTOR[j.axis];
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
    // With a tool mounted, that's its grip point: the middle of the gripper.
    const primary = this.endEffectors[0];
    const last = primary
      ? (primary.grasp || primary.tip)
      : (this.joints.length ? this.joints[this.joints.length - 1].tip : this.baseTip);
    last.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(last.matrixWorld);
  }

rebuildJointGeometry(j) {
    // Release the shared CAD geometry this joint currently holds; the rebuild
    // re-acquires it. Never dispose a shared (library-owned) geometry here.
    if (j.meshId && this.meshSet && this.meshSet !== 'procedural' && !j.procGripper) {
      MeshLibrary.releaseLink(this.meshSet, j.meshId);
    }
    if (j.housing) {
      j.group.remove(j.housing);
      j.housing.traverse(o => {
        if (o.isMesh) { if (!o.userData.sharedGeometry) o.geometry?.dispose?.(); o.material?.dispose?.(); }
      });
    }
    if (j.linkGroup) {
      j.articulator.remove(j.linkGroup);
      j.linkGroup.traverse(o => {
        if (o.isMesh) { if (!o.userData.sharedGeometry) o.geometry?.dispose?.(); o.material?.dispose?.(); }
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
    if (j.tipOffset) {
      j.tip.position.copy(j.tipOffset);
    } else {
      const tipDir2 = LINK_AXIS_VECTOR[j.link.axis || '+y'] || LINK_AXIS_VECTOR['+y'];
      j.tip.position.copy(tipDir2).multiplyScalar(j.link.length);
    }

    this._applyJointTransform(j);
  }

  /** Slide the CAD gripper's jaws apart along their local Z rail. t in [0,1].
   *  At t=0 the jaws are pressed together (mated); at t=1 they open by `travel`. */
  /**
   * Open/close the gripper. t in [0,1]: 0 = jaws closed flush, 1 = fully open.
   * Each jaw group's origin IS its gripping face, so the faces end up exactly
   * 2·d apart — there is no gap to tune away.
   */
  setGripperOpen(t) {
    this.gripperOpen = clamp(t ?? 0, 0, 1);
    const j = this.gripperJoint;
    if (!j || !j.fingers) return false;
    const closeInset = 0.006; // metres each jaw presses past rest to mate when closed
    const travel = 0.03;      // metres each jaw slides from closed to fully open (jaw tip
                               // stays inside the ±92mm rail housing at full travel)
    let dz = -closeInset + this.gripperOpen * (travel + closeInset);
    if (this._holdHalf) dz = Math.max(dz, Math.min(travel, this._holdHalf));   // jaw faces stop on the object
    const own = this.endEffectors.find(e => e.own);
    if (own) own.params.open = this.gripperOpen;
    for (const m of j.fingers.up)   m.position.z = (m.userData.rest?.z ?? 0) + dz;
    for (const m of j.fingers.down) m.position.z = (m.userData.rest?.z ?? 0) - dz;
    return true;
  }

  hasGripper() { return !!this.gripperJoint; }

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
      if (j.partMeshes && j.partMeshes.length) arr.push(...j.partMeshes);
      else {
        if (j.jointMesh) arr.push(j.jointMesh);
        if (j.linkMesh) arr.push(j.linkMesh);
      }
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
