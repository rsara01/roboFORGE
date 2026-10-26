/**
 * Turn a parsed URDF model into a Three.js object tree.
 *
 * Layout per joint, matching the URDF spec:
 *   parent link ─ joint.frame (fixed origin xyz/rpy) ─ joint.motion (the joint's
 *   own rotation or slide about its axis) ─ child link
 * URDF is Z-up and Three.js is Y-up, so everything hangs off one group turned
 * -90° about X. Meshes come out of the package VFS; STL, DAE, OBJ (+MTL) and
 * glTF/GLB are supported.
 */

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { baseOf } from './vfs.js';

const DEFAULT_COLOR = 0xb9bcc1;

/** URDF rpy is fixed-axis roll (X), pitch (Y), yaw (Z): R = Rz·Ry·Rx. */
export function applyOrigin(obj, origin) {
  obj.position.set(...origin.xyz);
  obj.rotation.set(origin.rpy[0], origin.rpy[1], origin.rpy[2], 'ZYX');
}

function urdfMaterial(mat, vfs, urdfPath, textures) {
  const m = new THREE.MeshStandardMaterial({ color: DEFAULT_COLOR, roughness: 0.6, metalness: 0.08 });
  if (mat?.color) {
    const [r, g, b, a] = mat.color;
    m.color.setRGB(r, g, b, THREE.SRGBColorSpace);
    if (a < 1) { m.transparent = true; m.opacity = a; m.depthWrite = false; }
  }
  if (mat?.texture) {
    const path = vfs.resolve(mat.texture, urdfPath);
    if (path) {
      let t = textures.get(path);
      if (!t) { t = new THREE.TextureLoader().load(vfs.url(path)); t.colorSpace = THREE.SRGBColorSpace; textures.set(path, t); }
      m.map = t;
      if (!mat.color) m.color.set(0xffffff);
    }
  }
  return m;
}

function primitive(g) {
  let geo;
  switch (g.type) {
    case 'box': geo = new THREE.BoxGeometry(...g.size); break;
    case 'sphere': geo = new THREE.SphereGeometry(g.radius, 32, 20); break;
    case 'cylinder': geo = new THREE.CylinderGeometry(g.radius, g.radius, g.length, 32).rotateX(Math.PI / 2); break;  // URDF cylinders run along Z
    case 'capsule': geo = new THREE.CapsuleGeometry(g.radius, g.length, 8, 24).rotateX(Math.PI / 2); break;
    default: return null;
  }
  return geo;
}

/**
 * Loads each mesh file once (by resolved path) and hands back clones.
 * The LoadingManager maps a DAE's / glTF's / MTL's relative texture and .bin
 * references back into the VFS, so packages with textures just work.
 */
class MeshCache {
  constructor(vfs) {
    this.vfs = vfs;
    this.cache = new Map();
  }

  _manager(fromFile) {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (/^(blob|data):/.test(url)) return url;
      const rel = url.replace(/^vfs:\/*/, '');
      const hit = this.vfs.relative(fromFile, rel) || this.vfs.resolve(baseOf(rel), fromFile);
      return hit ? this.vfs.url(hit) : url;
    });
    return manager;
  }

  /** @returns {Promise<{object: THREE.Object3D, ownMaterials: boolean}>} */
  load(path) {
    if (!this.cache.has(path)) this.cache.set(path, this._load(path));
    return this.cache.get(path).then(({ object, ownMaterials }) => ({ object: object.clone(true), ownMaterials }));
  }

  async _load(path) {
    const bytes = this.vfs.files.get(path);
    const ext = (/\.([a-z0-9]+)$/i.exec(path)?.[1] || '').toLowerCase();
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const manager = this._manager(path);
    switch (ext) {
      case 'stl': {
        return { object: new THREE.Mesh(new STLLoader(manager).parse(buf)), ownMaterials: false };
      }
      case 'dae': {
        const dae = new ColladaLoader(manager).parse(new TextDecoder().decode(bytes), 'vfs:/');
        // ColladaLoader turns every file Y-up for Three.js. URDF link frames
        // are Z-up, so turn it back: Z_UP files end up untouched, Y_UP files
        // get stood up, which is what RViz does. Unit scale is kept.
        const zUp = new THREE.Group();
        zUp.rotation.x = Math.PI / 2;
        zUp.add(dae.scene);
        // Many exporters write <transparent opaque="RGB_ZERO"> with a white
        // colour, which by the letter of the spec means "invisible". RViz
        // ignores it; so do we, for anything that would vanish completely.
        dae.scene.traverse(o => {
          for (const m of [o.material].flat()) {
            if (m && m.opacity < 0.05) { m.opacity = 1; m.transparent = false; }
          }
        });
        return { object: zUp, ownMaterials: true };
      }
      case 'obj': {
        const text = new TextDecoder().decode(bytes);
        const loader = new OBJLoader(manager);
        const mtl = /^mtllib\s+(.+)$/m.exec(text)?.[1]?.trim();
        const mtlPath = mtl && this.vfs.relative(path, mtl);
        if (mtlPath) {
          const mats = new MTLLoader(manager).setResourcePath('vfs:/').parse(this.vfs.text(mtlPath), 'vfs:/');
          mats.preload();
          loader.setMaterials(mats);
        }
        return { object: loader.parse(text), ownMaterials: !!mtlPath };
      }
      case 'glb':
      case 'gltf': {
        const gltf = await new Promise((res, rej) => new GLTFLoader(manager).parse(ext === 'glb' ? buf : new TextDecoder().decode(bytes), 'vfs:/', res, rej));
        return { object: gltf.scene, ownMaterials: true };
      }
      default:
        throw new Error(`no loader for .${ext} files`);
    }
  }
}

export class UrdfRobot {
  /**
   * @param {ReturnType<import('./parse.js').parseURDF>} model
   * @param {import('./vfs.js').VFS} vfs
   * @param {string} urdfPath  the URDF's path inside the VFS (for relative meshes)
   */
  constructor(model, vfs, urdfPath) {
    this.model = model;
    this.vfs = vfs;
    this.urdfPath = urdfPath;
    this.group = new THREE.Group();
    this.group.name = `urdf:${model.name}`;
    this.group.rotation.x = -Math.PI / 2;          // URDF Z-up → Three Y-up
    this.links = new Map();                         // name → { obj, visual, collision, frame, com }
    this.joints = new Map();                        // name → { joint, frame, motion, value, axisHelper }
    this.missing = [];                              // mesh refs we couldn't find
    this.failed = [];                               // mesh files that wouldn't load
    this.stats = { meshes: 0, triangles: 0 };
    this._textures = new Map();
    this._helpers = [];
    this.show = { visual: true, collision: false, frames: false, axes: false, com: false };
  }

  /** Build the tree and load every mesh. Resolves once all meshes are in. */
  async build(onProgress) {
    const { model } = this;
    for (const l of model.links.values()) {
      const obj = new THREE.Object3D(); obj.name = l.name;
      const visual = new THREE.Group(); visual.name = 'visual';
      const collision = new THREE.Group(); collision.name = 'collision'; collision.visible = false;
      obj.add(visual, collision);
      this.links.set(l.name, { obj, visual, collision, link: l, frame: null, com: null });
    }
    // Attach links through their joints, starting from every root so a broken
    // file still shows all of its parts.
    const attach = (linkName, parentObj, depth) => {
      const L = this.links.get(linkName);
      parentObj.add(L.obj);
      for (const j of model.childJoints.get(linkName) || []) {
        if (depth > 256) return;
        const frame = new THREE.Object3D(); frame.name = `joint:${j.name}`;
        applyOrigin(frame, j.origin);
        const motion = new THREE.Object3D();
        frame.add(motion);
        L.obj.add(frame);
        this.joints.set(j.name, { joint: j, frame, motion, value: 0, axisHelper: null });
        attach(j.child, motion, depth + 1);
      }
    };
    for (const r of model.roots) attach(r, this.group, 0);

    // Geometry.
    const cache = new MeshCache(this.vfs);
    const collisionMat = new THREE.MeshBasicMaterial({ color: 0x7fb4ff, transparent: true, opacity: 0.35, depthWrite: false });
    const jobs = [];
    let done = 0, total = 0;
    const tick = () => onProgress?.(++done, total);

    const addGeom = (target, item, material, isVisual) => {
      const holder = new THREE.Group();
      applyOrigin(holder, item.origin);
      target.add(holder);
      const g = item.geometry;
      if (g.type !== 'mesh') {
        const geo = primitive(g);
        if (geo) holder.add(new THREE.Mesh(geo, material));
        return;
      }
      holder.scale.set(...g.scale);
      const path = this.vfs.resolve(g.filename, this.urdfPath);
      if (!path) { this.missing.push(g.filename); return; }
      total++;
      jobs.push(cache.load(path).then(({ object, ownMaterials }) => {
        object.traverse(o => {
          if (!o.isMesh) return;
          if (!isVisual || !ownMaterials) o.material = material;
        });
        holder.add(object);
      }).catch(err => { this.failed.push({ file: path, error: err.message }); }).finally(tick));
    };

    for (const L of this.links.values()) {
      for (const v of L.link.visuals) addGeom(L.visual, v, urdfMaterial(v.material, this.vfs, this.urdfPath, this._textures), true);
      for (const c of L.link.collisions) addGeom(L.collision, c, collisionMat, false);
    }
    this.missing = [...new Set(this.missing)];
    onProgress?.(0, total);
    await Promise.all(jobs);

    this.group.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const pos = o.geometry.attributes.position;
      if (pos && o.parent && !this._isCollision(o)) {
        this.stats.meshes++;
        this.stats.triangles += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
      }
    });
    this._makeHelpers();
    this.setAll(this.homePose());
    return this;
  }

  _isCollision(o) {
    for (let p = o; p; p = p.parent) if (p.name === 'collision') return true;
    return false;
  }

  /** Size helpers to the robot: frames, joint axes and centres of mass. */
  _makeHelpers() {
    this.group.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(this.group);
    const size = box.isEmpty() ? 0.5 : box.getSize(new THREE.Vector3()).length();
    const s = THREE.MathUtils.clamp(size * 0.06, 0.015, 0.25);
    this.size = size;

    for (const L of this.links.values()) {
      L.frame = new THREE.AxesHelper(s);
      L.frame.visible = this.show.frames;
      L.frame.material.depthTest = false; L.frame.renderOrder = 10;
      L.obj.add(L.frame);
      if (L.link.inertial) {
        L.com = new THREE.Mesh(new THREE.SphereGeometry(s * 0.18, 16, 10), new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false }));
        L.com.add(new THREE.Mesh(new THREE.SphereGeometry(s * 0.12, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })));
        L.com.renderOrder = 11;
        L.com.position.set(...L.link.inertial.origin.xyz);
        L.com.visible = this.show.com;
        L.obj.add(L.com);
      }
    }
    for (const J of this.joints.values()) {
      const { type, axis } = J.joint;
      if (type === 'fixed' || type === 'floating') continue;
      J.axisHelper = new THREE.ArrowHelper(new THREE.Vector3(...axis), new THREE.Vector3(), s * 1.6, 0xf08327, s * 0.4, s * 0.22);
      J.axisHelper.traverse(o => { if (o.material) { o.material.depthTest = false; } o.renderOrder = 12; });
      J.axisHelper.visible = this.show.axes;
      J.frame.add(J.axisHelper);
    }
  }

  setShow(key, on) {
    this.show[key] = on;
    for (const L of this.links.values()) {
      if (key === 'visual') L.visual.visible = on;
      if (key === 'collision') L.collision.visible = on;
      if (key === 'frames' && L.frame) L.frame.visible = on;
      if (key === 'com' && L.com) L.com.visible = on;
    }
    if (key === 'axes') for (const J of this.joints.values()) if (J.axisHelper) J.axisHelper.visible = on;
  }

  /** Joint range for a slider: limits for revolute/prismatic, ±π for continuous. */
  range(j) {
    if (j.type === 'continuous') return [-Math.PI, Math.PI];
    if (j.limit) return [j.limit.lower, j.limit.upper];
    return [0, 0];
  }

  /** 0 where the range allows it, otherwise the middle of the range. */
  homePose() {
    const pose = {};
    for (const J of this.joints.values()) {
      const [lo, hi] = this.range(J.joint);
      pose[J.joint.name] = lo <= 0 && hi >= 0 ? 0 : (lo + hi) / 2;
    }
    return pose;
  }

  getJoint(name) { return this.joints.get(name)?.value ?? 0; }

  /** Set one joint (clamped to its limits), then update anything mimicking it. */
  setJoint(name, value) {
    const J = this.joints.get(name);
    if (!J) return;
    const j = J.joint;
    if (j.type === 'revolute' || j.type === 'prismatic') {
      const [lo, hi] = this.range(j);
      value = Math.min(hi, Math.max(lo, value));
    }
    this.applyJoint(name, value);
  }

  /** Pose one joint without clamping (callers that own the limits use this), then its mimics. */
  applyJoint(name, value, depth = 0) {
    const J = this.joints.get(name);
    if (!J || depth > 16) return;      // a mimic loop in the file stops here
    const j = J.joint;
    J.value = value;
    const ax = new THREE.Vector3(...j.axis);
    if (j.type === 'revolute' || j.type === 'continuous') { J.motion.position.set(0, 0, 0); J.motion.quaternion.setFromAxisAngle(ax, value); }
    else if (j.type === 'prismatic') { J.motion.quaternion.identity(); J.motion.position.copy(ax).multiplyScalar(value); }
    for (const F of this.joints.values()) {
      const m = F.joint.mimic;
      if (m && m.joint === name && F !== J) this.applyJoint(F.joint.name, value * m.multiplier + m.offset, depth + 1);
    }
  }

  setAll(pose) { for (const [n, v] of Object.entries(pose)) this.setJoint(n, v); }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(o => {
      o.geometry?.dispose?.();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) { m.map?.dispose?.(); m.dispose?.(); }
    });
    for (const t of this._textures.values()) t.dispose();
    this.vfs.dispose();
  }
}
