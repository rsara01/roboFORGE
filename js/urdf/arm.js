/**
 * An imported URDF robot dressed up as an Arm Lab arm.
 *
 * It exposes the same surface as Robot (robot.js): a `joints` array whose
 * entries carry group / articulator / tip / axisVec / min / max / value, plus
 * setJointValue, _applyJointTransform, _hasViolation, end effectors and so on.
 * That is all the IK solver, scripting, recording, plotting, torque readout and
 * inspector look at, so they drive an imported robot without knowing it is one.
 *
 * How the URDF tree maps onto that serial-arm view:
 *  - The "tool tip" is one link (a TCP / end-effector / gripper-frame link if
 *    the file names one, otherwise the end of the longest chain).
 *  - Movable joints on the path from the base to that tip are the arm joints,
 *    in order, and are what IK moves.
 *  - Movable joints that branch off near the tip (fingers, jaws) become the
 *    robot's own gripper: gripper(0..1) and the Gripper slider drive them.
 *  - Any other movable joints are listed and scriptable but IK leaves them alone.
 */

import * as THREE from 'three';

const GRIP_NAME = /finger|grip|jaw|claw|pinch|thumb/i;
const TIP_NAME = /tcp|tool|end_?effector|(^|_)ee(_|$)|eef|gripper_frame|grasp|flange|tip/i;
const MOVABLE = new Set(['revolute', 'continuous', 'prismatic']);

let _idCounter = 1_000_000;           // well clear of Robot's own ids
const _v = new THREE.Vector3();

/** Path of joints (fixed ones included) from the base down to `link`. */
function pathTo(model, link) {
  const path = [];
  for (let n = link; model.parentOf.has(n);) { const j = model.parentOf.get(n); path.unshift(j); n = j.parent; }
  return path;
}

/** Pick the link that should act as the tool tip. */
export function chooseTipLink(model) {
  const leaves = [...model.links.keys()].filter(n => !(model.childJoints.get(n) || []).length);
  const score = (n) => pathTo(model, n).filter(j => MOVABLE.has(j.type) && !j.mimic && !GRIP_NAME.test(j.name)).length;
  const named = leaves.filter(n => TIP_NAME.test(n)).sort((a, b) => score(b) - score(a));
  if (named.length) return named[0];
  // Longest arm chain wins. A finger hanging off the hand scores the same as
  // the hand itself, so on a tie prefer the leaf that isn't a gripper part.
  const ranked = leaves.map(n => ({ n, s: score(n), grip: GRIP_NAME.test(n) || pathTo(model, n).some(j => GRIP_NAME.test(j.name)) }))
    .sort((a, b) => b.s - a.s || a.grip - b.grip);
  const best = ranked[0];
  if (!best) return model.root;
  // If the best leaf is still a finger, use the link it hangs from (the hand).
  if (best.grip) {
    const p = pathTo(model, best.n);
    const firstGrip = p.findIndex(j => GRIP_NAME.test(j.name) || GRIP_NAME.test(j.child));
    if (firstGrip > 0) return p[firstGrip].parent;
  }
  return best.n;
}

export class UrdfArm {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./build.js').UrdfRobot} urdf  a built UrdfRobot
   * @param {{ tipLink?: string, fileName?: string, urdfText?: string }} [opts]
   */
  constructor(scene, urdf, opts = {}) {
    this.isUrdf = true;
    this.scene = scene;
    this.urdf = urdf;
    this.model = urdf.model;
    this.name = urdf.model.name;
    this.fileName = opts.fileName || '';
    this.urdfText = opts.urdfText || '';
    this.meshSet = 'urdf';
    this.joints = [];
    this.endEffectors = [];
    this.showAxes = true;
    this.colors = {};
    this.floorClearance = true;
    this.floorY = 0.005;
    this.selfCollision = true;
    this.selfCollisionSlack = -0.005;
    this.gripperOpen = 1;

    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'robot-root';
    this.rootGroup.add(urdf.group);
    scene.add(this.rootGroup);
    this.rootGroup.updateWorldMatrix(true, true);

    this._setTip(opts.tipLink && this.model.links.has(opts.tipLink) ? opts.tipLink : chooseTipLink(this.model));
  }

  // ---------- structure ----------

  /** (Re)build the joint list around a tool-tip link. Keeps joint values. */
  _setTip(tipLink) {
    const keepEEs = this.endEffectors.filter(ee => !ee.own);
    for (const ee of this.endEffectors) ee.group.removeFromParent();
    this.endEffectors = [];
    for (const j of this.joints) j.axesHelper?.removeFromParent();
    this.toolTip?.removeFromParent();

    const { model, urdf } = this;
    this.tipLink = tipLink;
    const chain = pathTo(model, tipLink).filter(j => MOVABLE.has(j.type) && !j.mimic);
    const onChain = new Set(chain.map(j => j.name));
    const lastChainChild = chain.length ? chain[chain.length - 1].child : model.root;
    const nearTip = new Set();
    const collect = (link) => { for (const j of model.childJoints.get(link) || []) { nearTip.add(j.name); collect(j.child); } };
    collect(lastChainChild);

    const rest = [...urdf.joints.values()].map(J => J.joint)
      .filter(j => MOVABLE.has(j.type) && !j.mimic && !onChain.has(j.name));
    const grip = rest.filter(j => nearTip.has(j.name) && (GRIP_NAME.test(j.name) || GRIP_NAME.test(j.child) || rest.length <= 2));
    const other = rest.filter(j => !grip.includes(j));

    // Tool tip: the tip link's origin. EEs mount on a child frame turned so
    // its +Y points the way the arm reaches (the convention the built-in
    // end effectors are modelled in).
    this.toolTip = new THREE.Object3D();
    this.toolTip.name = 'tool-tip';
    urdf.links.get(tipLink).obj.add(this.toolTip);
    this.mount = new THREE.Object3D();
    this.mount.name = 'ee-mount';
    this.toolTip.add(this.mount);
    this.rootGroup.updateWorldMatrix(true, true);
    const reach = this._approachDir(chain);
    this.mount.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), reach);

    const size = urdf.size || 1;
    const make = (uj, role) => {
      const J = urdf.joints.get(uj.name);
      const lim = uj.type === 'continuous' ? [-2 * Math.PI, 2 * Math.PI] : [uj.limit?.lower ?? 0, uj.limit?.upper ?? 0];
      const old = this.joints.find(o => o.urdfName === uj.name);
      const ax = new THREE.Vector3(...uj.axis);
      const j = {
        id: old?.id ?? _idCounter++,
        name: old?.name ?? uj.name,
        urdfName: uj.name,
        type: uj.type === 'prismatic' ? 'prismatic' : 'revolute',
        urdfType: uj.type,
        axis: ['x', 'y', 'z'][[0, 1, 2].reduce((b, i) => Math.abs(uj.axis[i]) > Math.abs(uj.axis[b]) ? i : b, 0)],
        axisVec: ax,
        value: J.value,
        min: old?.min ?? lim[0],
        max: old?.max ?? lim[1],
        group: J.frame,
        articulator: J.motion,
        tip: null,
        link: { length: 0, radius: 0.03, color: old?.link.color ?? null, axis: '+y' },
        role,
        ikSkip: role !== 'arm',
      };
      j.axesHelper = new THREE.AxesHelper(Math.max(0.03, size * 0.08));
      j.axesHelper.visible = this.showAxes;
      j.group.add(j.axesHelper);
      return j;
    };
    this.joints = [...chain.map(j => make(j, 'arm')), ...grip.map(j => make(j, 'gripper')), ...other.map(j => make(j, 'other'))];
    this.armJointCount = chain.length;
    this.gripJoints = this.joints.filter(j => j.role === 'gripper');

    // Tips and capsule sizes for the collision checks and torque readout.
    this.joints.forEach((j, i) => {
      if (j.role === 'arm') j.tip = i + 1 < chain.length ? this.joints[i + 1].group : this.toolTip;
      else j.tip = urdf.links.get(urdf.joints.get(j.urdfName).joint.child).obj;
      const a = new THREE.Vector3().setFromMatrixPosition(j.articulator.matrixWorld);
      const b = new THREE.Vector3().setFromMatrixPosition(j.tip.matrixWorld);
      j.link.length = a.distanceTo(b);
      j.link.radius = this._thickness(urdf.joints.get(j.urdfName).joint.child);
      j.link.mass = this._massBetween(j);
    });
    this._tagLinks();

    // Like MoveIt's setup assistant: segment pairs that already overlap in the
    // rest pose are built that way (an elbow housing next to its forearm), so
    // they are never counted as a collision.
    this._ignorePairs = new Set();
    for (const [p, q] of this._overlappingPairs()) this._ignorePairs.add(`${p},${q}`);

    // Floor check points that already sit on the floor at rest (the base,
    // a joint at ground level) can't be held to it.
    this._floorExempt = new Set();
    for (const p of this._floorPoints()) if (_v.setFromMatrixPosition(p.matrixWorld).y < this.floorY + 0.01) this._floorExempt.add(p);

    // The robot's own fingers become a mounted gripper, so gripper(), grab()
    // and release() work exactly as with the built-in one.
    if (this.gripJoints.length) this._mountOwnGripper();
    for (const ee of keepEEs) this.addEndEffector(ee);
    this.setGripperOpen(this.gripperOpen);
  }

  /** Unit vector (in tool-tip coordinates) along which the arm reaches. */
  _approachDir(chain) {
    const tipW = new THREE.Vector3().setFromMatrixPosition(this.toolTip.matrixWorld);
    // From the last arm joint that is clearly behind the tip.
    for (let i = chain.length - 1; i >= 0; i--) {
      const J = this.urdf.joints.get(chain[i].name);
      const p = new THREE.Vector3().setFromMatrixPosition(J.frame.matrixWorld);
      if (p.distanceTo(tipW) > 0.02) {
        const inv = new THREE.Matrix4().copy(this.toolTip.matrixWorld).invert();
        const d = tipW.clone().applyMatrix4(inv).sub(p.applyMatrix4(inv));
        if (d.lengthSq() > 1e-8) return d.normalize();
      }
    }
    return new THREE.Vector3(0, 0, 1);
  }

  /** Rough link thickness for the self-collision capsules (kept on the thin side). */
  _thickness(linkName) {
    const L = this.urdf.links.get(linkName);
    const box = new THREE.Box3();
    L.visual.traverse(o => { if (o.isMesh) box.expandByObject(o, true); });
    if (box.isEmpty()) return 0.02;
    const s = box.getSize(new THREE.Vector3()).toArray().sort((a, b) => a - b);
    return THREE.MathUtils.clamp(s[1] * 0.3, 0.01, 0.12);
  }

  /** Mass carried between this joint and the next arm joint (URDF inertials). */
  _massBetween(j) {
    let m = 0;
    const stop = new Set(this.joints.filter(o => o !== j).map(o => o.urdfName));
    const walk = (link) => {
      m += this.model.links.get(link)?.inertial?.mass || 0;
      for (const cj of this.model.childJoints.get(link) || []) if (!stop.has(cj.name)) walk(cj.child);
    };
    walk(this.urdf.joints.get(j.urdfName).joint.child);
    return m || null;
  }

  /** Mark every link with the joint that moves it, for clicking and recoloring. */
  _tagLinks() {
    const byName = new Map(this.joints.map(j => [j.urdfName, j]));
    for (const [name, L] of this.urdf.links) {
      let owner = null;
      for (let n = name; this.model.parentOf.has(n) && !owner;) {
        const pj = this.model.parentOf.get(n);
        owner = byName.get(pj.name) || (pj.mimic && byName.get(pj.mimic.joint)) || null;
        n = pj.parent;
      }
      L.obj.userData.jointId = owner?.id ?? null;
      L.ownerJoint = owner;
    }
  }

  _mountOwnGripper() {
    const group = new THREE.Group();
    group.name = 'ee-urdf-gripper';
    const tip = new THREE.Object3D();      // the file's tool frame (near the fingertips)
    const grasp = new THREE.Object3D();    // the middle of the fingers: what IK steers
    group.add(tip, grasp);
    const arm = this;
    const params = { open: this.gripperOpen };
    this.addEndEffector({
      type: 'gripper',
      own: true,
      label: 'Own gripper',
      group, tip, grasp, params,
      pickables: [],
      setParam(name, val) { if (name === 'open') { params.open = THREE.MathUtils.clamp(+val, 0, 1); arm.setGripperOpen(params.open, true); } },
      setHold(body) { arm._setHold(body); },
      update() {},
      dispose() {},
    });
    grasp.position.copy(this._gripCenter());
  }

  /** Links moved by the gripper joints (and anything mimicking them). */
  _fingerLinks(j = null) {
    const out = [];
    for (const L of this.urdf.links.values()) if (L.ownerJoint && (j ? L.ownerJoint === j : L.ownerJoint.role === 'gripper')) out.push(L);
    return out;
  }

  /**
   * Middle of the fingers, in the mount frame: the centre of the finger links
   * with the gripper closed. If only one jaw moves (the other is part of the
   * hand), that centre sits on the moving jaw, so pull it halfway back toward
   * the file's own tool frame, which sits between the jaws.
   */
  _gripCenter() {
    const links = this._fingerLinks();
    if (!links.length) return new THREE.Vector3();
    const saved = this.gripJoints.map(j => j.value);
    for (const j of this.gripJoints) { j.value = j.min; this._applyJointTransform(j); }
    this.rootGroup.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    for (const L of links) L.visual.traverse(o => { if (o.isMesh) box.expandByObject(o, true); });
    this.gripJoints.forEach((j, i) => { j.value = saved[i]; this._applyJointTransform(j); });
    this.rootGroup.updateWorldMatrix(true, true);
    if (box.isEmpty()) return new THREE.Vector3();
    const c = this.mount.worldToLocal(box.getCenter(new THREE.Vector3()));
    const moving = new Set(links.map(L => L.ownerJoint));
    if (moving.size === 1 && links.length === 1) c.set(c.x / 2, c.y, c.z / 2);
    return c;
  }

  /**
   * Fingers stop on a held object: for each finger joint, walk it from open
   * toward closed and remember the last value where none of its vertices are
   * inside the object's box.
   */
  _setHold(body) {
    this._holdLimit = new Map();
    if (body) {
      body.mesh.updateWorldMatrix(true, false);
      const toBody = new THREE.Matrix4().copy(body.mesh.matrixWorld).invert();
      const h = (body.halfExtents || 0.03) - 0.001;
      for (const j of this.gripJoints) {
        const pts = [];
        for (const L of this._fingerLinks(j)) L.visual.traverse(o => {
          if (!o.isMesh) return;
          const pos = o.geometry.attributes.position;
          const step = Math.max(1, Math.floor(pos.count / 1500));
          for (let i = 0; i < pos.count; i += step) pts.push([o, new THREE.Vector3().fromBufferAttribute(pos, i)]);
        });
        const saved = j.value;
        let limit = j.min;
        const inside = () => {
          this.rootGroup.updateWorldMatrix(true, true);
          for (const [o, v] of pts) {
            const p = v.clone().applyMatrix4(o.matrixWorld).applyMatrix4(toBody);
            if (Math.abs(p.x) < h && Math.abs(p.y) < h && Math.abs(p.z) < h) return true;
          }
          return false;
        };
        const N = 40;
        for (let k = 0; k <= N; k++) {
          j.value = THREE.MathUtils.lerp(j.max, j.min, k / N);
          this._applyJointTransform(j);
          if (inside()) { limit = THREE.MathUtils.lerp(j.max, j.min, Math.max(0, k - 1) / N); break; }
        }
        j.value = saved;
        this._applyJointTransform(j);
        this._holdLimit.set(j, limit);
      }
    }
    this.setGripperOpen(this.gripperOpen);
  }

  /** Choose a different tool-tip link (from the URDF tab). */
  setTipLink(name) {
    if (!this.model.links.has(name) || name === this.tipLink) return;
    this._setTip(name);
  }

  // ---------- Robot API: joints ----------

  addJoint() { return null; }          // the URDF fixes the structure
  removeLastJoint() {}
  removeJoint() {}
  clear() { this.detachAllEndEffectors(); }
  rebuildJointGeometry(j) { this._paintLinks(); this._applyJointTransform(j); }
  updateAll() { for (const j of this.joints) this._applyJointTransform(j); }

  _applyJointTransform(j) { this.urdf.applyJoint(j.urdfName, j.value); }

  _snapshotJointValues() { return this.joints.map(j => j.value); }
  _restoreJointValues(snap) {
    for (let i = 0; i < this.joints.length && i < snap.length; i++) { this.joints[i].value = snap[i]; this._applyJointTransform(this.joints[i]); }
  }

  setJointValue(index, value) {
    const j = this.joints[index];
    if (!j) return;
    const old = j.value;
    j.value = THREE.MathUtils.clamp(value, j.min, j.max);
    this._applyJointTransform(j);
    if (j.role !== 'gripper' && this._hasViolation()) { j.value = old; this._applyJointTransform(j); }
  }
  getJointValue(index) { return this.joints[index]?.value ?? 0; }
  setAllJoints(values) {
    const snap = this._snapshotJointValues();
    for (let i = 0; i < this.joints.length && i < values.length; i++) {
      const j = this.joints[i];
      j.value = THREE.MathUtils.clamp(values[i], j.min, j.max);
      this._applyJointTransform(j);
    }
    if (this._hasViolation()) this._restoreJointValues(snap);
  }

  getEndEffectorWorldPosition(target = new THREE.Vector3()) {
    const ee = this.endEffectors[0];
    const t = ee ? (ee.grasp || ee.tip) : this.toolTip;
    t.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(t.matrixWorld);
  }

  // ---------- collisions ----------

  _floorPoints() {
    const pts = this.joints.filter(j => j.role === 'arm').map(j => j.tip);
    pts.push(this.toolTip);
    for (const ee of this.endEffectors) pts.push(ee.tip);
    return pts;
  }

  checkFloorClearance() {
    for (const p of this._floorPoints()) {
      if (this._floorExempt?.has(p)) continue;
      p.updateWorldMatrix(true, false);
      if (_v.setFromMatrixPosition(p.matrixWorld).y < this.floorY) return true;
    }
    return false;
  }

  /** Capsules along each arm segment; neighbours and pairs that touch at rest are skipped. */
  checkSelfCollision() {
    for (const _ of this._overlappingPairs(true)) return true;
    return false;
  }

  /** Yields [i, k] joint-index pairs whose capsules overlap right now. */
  *_overlappingPairs(skipIgnored = false) {
    const segs = [];
    this.joints.forEach((j, i) => {
      if (j.role !== 'arm' || j.link.length < 0.02) return;
      j.articulator.updateWorldMatrix(true, false);
      j.tip.updateWorldMatrix(true, false);
      segs.push({ i, a: new THREE.Vector3().setFromMatrixPosition(j.articulator.matrixWorld), b: new THREE.Vector3().setFromMatrixPosition(j.tip.matrixWorld), r: j.link.radius });
    });
    for (let p = 0; p < segs.length; p++) {
      for (let q = p + 1; q < segs.length; q++) {
        const A = segs[p], B = segs[q];
        if (B.i - A.i < 2 || A.b.distanceTo(B.a) < 1e-4) continue;
        if (skipIgnored && this._ignorePairs.has(`${A.i},${B.i}`)) continue;
        const minD = A.r + B.r + this.selfCollisionSlack;
        if (minD > 0 && segSegDistanceSq(A.a, A.b, B.a, B.b) < minD * minD) yield [A.i, B.i];
      }
    }
  }

  _hasViolation() {
    if (this.floorClearance && this.checkFloorClearance()) return true;
    if (this.selfCollision && this.checkSelfCollision()) return true;
    return false;
  }

  // ---------- gripper ----------

  hasGripper() { return this.gripJoints.length > 0; }

  /** 0 = closed (lower limit), 1 = open (upper limit). */
  setGripperOpen(t, fromEE = false) {
    this.gripperOpen = THREE.MathUtils.clamp(t ?? 0, 0, 1);
    for (const j of this.gripJoints) {
      j.value = THREE.MathUtils.lerp(j.min, j.max, this.gripperOpen);
      const stop = this._holdLimit?.get(j);
      if (stop != null) j.value = Math.max(j.value, stop);     // fingers rest on the held object
      this._applyJointTransform(j);
    }
    if (!fromEE) { const own = this.endEffectors.find(e => e.own); if (own) own.params.open = this.gripperOpen; }
    return this.gripJoints.length > 0;
  }

  // ---------- end effectors ----------

  get endEffector() { return this.endEffectors[0] || null; }

  addEndEffector(ee) {
    if (!ee) return null;
    this.mount.add(ee.group);
    ee.parentJoint = this.joints[this.armJointCount - 1] || null;
    this.endEffectors.push(ee);
    this._restackEndEffectors();
    return ee;
  }
  attachEndEffectorGroup(ee) { this.detachAllEndEffectors(); return this.addEndEffector(ee); }
  removeEndEffector(eeOrIndex) {
    const idx = typeof eeOrIndex === 'number' ? eeOrIndex : this.endEffectors.indexOf(eeOrIndex);
    if (idx < 0 || idx >= this.endEffectors.length) return;
    const ee = this.endEffectors.splice(idx, 1)[0];
    ee.group.parent?.remove(ee.group);
    ee.dispose?.();
    this._restackEndEffectors();
  }
  detachAllEndEffectors() { while (this.endEffectors.length) this.removeEndEffector(this.endEffectors.length - 1); }
  detachEndEffector() { this.detachAllEndEffectors(); }
  _restackEndEffectors() {
    // A tool added on top of the robot's own fingers goes first in line;
    // extra ones sit beside it, as on the built-in arm.
    this.endEffectors.forEach((ee, i) => {
      const offset = i === 0 ? 0 : 0.07 + (i - 1) * 0.07;
      const angle = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.PI * 0.5;
      ee.group.position.x = Math.cos(angle) * offset;
      ee.group.position.z = Math.sin(angle) * offset;
    });
  }

  // ---------- looks, picking ----------

  setShowAxes(v) {
    this.showAxes = v;
    for (const j of this.joints) if (j.axesHelper) j.axesHelper.visible = v;
  }

  setColor(key, hex) { this.colors[key] = hex; if (key === 'link') this._paintLinks(); }
  resetColors() { this.colors = {}; for (const j of this.joints) j.link.color = null; this._paintLinks(); }

  /** Recolor visual meshes: per-joint link color, else the global link color, else the file's own. */
  _paintLinks() {
    for (const L of this.urdf.links.values()) {
      const want = L.ownerJoint?.link.color ?? this.colors.link ?? null;
      L.visual.traverse(o => {
        if (!o.isMesh) return;
        for (const m of [o.material].flat()) {
          if (!m?.color) continue;
          if (m.userData.origColor == null) m.userData.origColor = m.color.getHex();
          m.color.setHex(want ?? m.userData.origColor);
        }
      });
    }
  }

  jointFromObject(obj) {
    for (let cur = obj; cur; cur = cur.parent) {
      if (cur.userData?.jointId != null) return this.joints.find(j => j.id === cur.userData.jointId) || null;
      if (cur === this.rootGroup) break;
    }
    return null;
  }

  pickableObjects() {
    const arr = [];
    for (const L of this.urdf.links.values()) L.visual.traverse(o => { if (o.isMesh) arr.push(o); });
    for (const ee of this.endEffectors) if (ee.pickables) arr.push(...ee.pickables);
    return arr;
  }

  dispose() {
    this.detachAllEndEffectors();
    this.rootGroup.removeFromParent();
    this.urdf.dispose();
  }
}

function segSegDistanceSq(a0, a1, b0, b1) {
  const d1 = new THREE.Vector3().subVectors(a1, a0), d2 = new THREE.Vector3().subVectors(b1, b0), r = new THREE.Vector3().subVectors(a0, b0);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) return a0.distanceToSquared(b0);
  if (a <= 1e-9) { s = 0; t = clamp(f / e); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-9) { t = 0; s = clamp(-c / a); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den !== 0 ? clamp((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a); } else if (t > 1) { t = 1; s = clamp((b - c) / a); }
    }
  }
  return d1.multiplyScalar(s).add(a0).distanceToSquared(d2.multiplyScalar(t).add(b0));
}
