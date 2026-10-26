/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║ RoboForge - Mesh Library (CAD provider layer)               ║
 * ║ Async loads + caches per-link CAD geometry (GLB/STL/STEP)   ║
 * ║ so the sync Robot builder can dress its kinematic chain in  ║
 * ║ real hardware meshes. Falls back to procedural on failure.  ║
 * ║ © 2024-2026. All rights reserved.                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * A "mesh set" (e.g. 'RS') is described by assets/<set>/manifest.json:
 *   { name, units, upAxis, links:[ { id, file, jointAxis, linkAxis,
 *       linkLength, collisionRadius, min, max, aabb } ] }
 * Every link mesh is pre-baked (offline) into its joint-local frame:
 *   local origin = that joint's rotation axis, meters, Y-up, canonical
 *   zero pose = straight +Y stack. See RS-INTEGRATION.md for the recipe.
 *
 * Geometries are cached and reference-counted; a shared BufferGeometry is
 * never disposed while any Robot still references it.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MANIFEST_PATH = (set) => `assets/${set}/manifest.json`;
const ASSET_PATH = (set, file) => `assets/${set}/${file}`;

// A joint's own drive motor is supposed to be bolted to the PARENT link, so it
// stays put as this joint rotates (only the child link should spin). The RS
// STEP assembly baked j2's and j6's own motor into their own link's GLB
// instead of the parent's — verified by inspecting rs_j2.glb / rs_j6.glb: the
// 'revolute'-coloured mesh has a motor-sized blob sitting at THIS joint's own
// local origin (in addition to, for j2, the next joint's motor near the tip,
// which is correctly placed and must keep rotating with j2). j3/j4/j5 don't
// have this problem — their own-pivot 'revolute' geometry is just a thin
// collar, and the real next-joint motor already lives in the preceding link.
// Radius (m) used to split 'revolute' geometry: components whose centroid is
// within this distance of the joint's own pivot are pulled into a 'housing'
// part that robot.js pins to the joint's static frame instead of its
// rotating articulator.
const HOUSING_SPLIT_RADIUS = { j2: 0.10, j6: 0.09 };

THREE.Cache.enabled = true;

class _MeshLibrary {
  constructor() {
    // set -> { manifest, links: Map<id, {parts, refs}>, byId: Map<id, entry> }
    // where parts = [{ geometry, colorKey }] — one entry per coloured primitive
    // in the link's GLB. A single-material GLB simply yields one part.
    this._sets = new Map();
    this._loading = new Map(); // set -> Promise
    this._gltf = new GLTFLoader();
  }

  isLoaded(set) { return this._sets.has(set); }
  getManifest(set) { return this._sets.get(set)?.manifest || null; }
  getLinkEntry(set, id) { return this._sets.get(set)?.byId.get(id) || null; }

  /** Ordered link entries that correspond to moving joints (excludes the base). */
  jointEntries(set) {
    const m = this.getManifest(set);
    if (!m) return [];
    return m.links.filter(l => l.id !== 'base');
  }
  baseEntry(set) { return this.getLinkEntry(set, 'base'); }

  /**
   * Load a manifest + all its GLB link geometries. Idempotent; concurrent
   * callers share one in-flight promise. Resolves when getLinkParts() is ready.
   */
  async load(set) {
    if (this._sets.has(set)) return this._sets.get(set);
    if (this._loading.has(set)) return this._loading.get(set);

    const p = (async () => {
      const res = await fetch(MANIFEST_PATH(set));
      if (!res.ok) throw new Error(`manifest ${set} HTTP ${res.status}`);
      const manifest = await res.json();
      if (!manifest || !Array.isArray(manifest.links)) {
        throw new Error(`manifest ${set} malformed`);
      }
      const links = new Map();
      const byId = new Map();
      for (const link of manifest.links) {
        byId.set(link.id, link);
        if (!link.file) continue;
        const parts = await this._loadGLBParts(ASSET_PATH(set, link.file), set, link.id);
        parts.forEach((p, i) => { p.geometry.name = `${set}:${link.id}:${p.colorKey}:${i}`; });
        links.set(link.id, { parts, refs: 0 });
      }
      const record = { manifest, links, byId };
      this._sets.set(set, record);
      this._loading.delete(set);
      return record;
    })();

    this._loading.set(set, p);
    try {
      return await p;
    } catch (err) {
      this._loading.delete(set);
      throw err;
    }
  }

  /**
   * Return the shared coloured parts [{geometry, colorKey}] for a link id, or
   * null if unavailable. Increments the reference count; pair with releaseLink()
   * on disposal. The geometries are shared — never dispose them from a Robot.
   */
  acquireLinkParts(set, id) {
    const slot = this._sets.get(set)?.links.get(id);
    if (!slot) return null;
    slot.refs++;
    return slot.parts;
  }

  /** Non-owning peek (no refcount change). */
  getLinkParts(set, id) {
    return this._sets.get(set)?.links.get(id)?.parts || null;
  }

  /** Is a CAD mesh available for this link id? */
  hasLink(set, id) {
    return !!this._sets.get(set)?.links.get(id);
  }

  /** Release a previously acquired link; kept alive across model switches. */
  releaseLink(set, id) {
    const slot = this._sets.get(set)?.links.get(id);
    if (!slot) return;
    slot.refs = Math.max(0, slot.refs - 1);
    // Cached geometries are kept alive on purpose so re-selecting the model is
    // instant. Full teardown happens in unload().
  }

  /** Drop a whole set from memory (disposes every cached geometry). */
  unload(set) {
    const rec = this._sets.get(set);
    if (!rec) return;
    for (const { parts } of rec.links.values()) for (const p of parts) p.geometry.dispose();
    this._sets.delete(set);
  }

  /**
   * Load every coloured primitive of a GLB as a separate part. Each part keeps
   * the material NAME the offline converter wrote (a robot.js colour key such as
   * 'revolute' | 'link' | 'base' | 'linkDark') so the app can tag + recolour it.
   */
  async _loadGLBParts(url, set, linkId) {
    const gltf = await this._gltf.loadAsync(url);
    gltf.scene.updateWorldMatrix(true, true);
    const parts = [];
    gltf.scene.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry.clone();
      o.updateWorldMatrix(true, false);
      g.applyMatrix4(o.matrixWorld);
      if (!g.attributes.normal) g.computeVertexNormals();
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      // material name is "colorKey" or "colorKey|role" (role = fingerUp/fingerDown
      // for the sliding gripper jaws).
      const raw = (mat && mat.name) ? mat.name : 'link';
      const [colorKey, role] = raw.split('|');
      parts.push({ geometry: g, colorKey, role: role || 'static' });
    });
    if (!parts.length) throw new Error(`no mesh in ${url}`);

    const splitRadius = set === 'RS' ? HOUSING_SPLIT_RADIUS[linkId] : null;
    if (splitRadius == null) return parts;

    const out = [];
    for (const p of parts) {
      if (p.colorKey !== 'revolute') { out.push(p); continue; }
      const { near, far } = this._splitNearOrigin(p.geometry, splitRadius);
      if (near) out.push({ geometry: near, colorKey: p.colorKey, role: 'housing' });
      if (far) out.push({ geometry: far, colorKey: p.colorKey, role: p.role });
      if (!near && !far) out.push(p);
    }
    return out;
  }

  /**
   * Split a merged CAD primitive by connected component: sub-meshes whose
   * centroid sits within `radius` of the joint's own local origin (its pivot)
   * go to `near`, everything else to `far`. See HOUSING_SPLIT_RADIUS above.
   */
  _splitNearOrigin(geometry, radius) {
    const pos = geometry.attributes.position;
    const idxAttr = geometry.index;
    if (!idxAttr) return { near: null, far: geometry };
    const nVerts = pos.count;
    const parent = new Int32Array(nVerts);
    for (let i = 0; i < nVerts; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    const ia = idxAttr.array;
    const triCount = ia.length / 3;
    for (let t = 0; t < triCount; t++) {
      union(ia[t * 3], ia[t * 3 + 1]);
      union(ia[t * 3 + 1], ia[t * 3 + 2]);
    }
    const trisByRoot = new Map();
    for (let t = 0; t < triCount; t++) {
      const r = find(ia[t * 3]);
      let list = trisByRoot.get(r);
      if (!list) trisByRoot.set(r, (list = []));
      list.push(t);
    }
    const nearTris = [];
    const farTris = [];
    for (const tris of trisByRoot.values()) {
      const seen = new Set();
      let cx = 0, cy = 0, cz = 0, n = 0;
      for (const t of tris) {
        for (let k = 0; k < 3; k++) {
          const v = ia[t * 3 + k];
          if (seen.has(v)) continue;
          seen.add(v);
          cx += pos.getX(v); cy += pos.getY(v); cz += pos.getZ(v); n++;
        }
      }
      cx /= n; cy /= n; cz /= n;
      const dist = Math.hypot(cx, cy, cz);
      (dist < radius ? nearTris : farTris).push(...tris);
    }
    const build = (triList) => {
      if (!triList.length) return null;
      const outIdx = new Uint32Array(triList.length * 3);
      for (let i = 0; i < triList.length; i++) {
        const t = triList[i];
        outIdx[i * 3] = ia[t * 3]; outIdx[i * 3 + 1] = ia[t * 3 + 1]; outIdx[i * 3 + 2] = ia[t * 3 + 2];
      }
      const g = geometry.clone();
      g.setIndex(new THREE.BufferAttribute(outIdx, 1));
      g.computeBoundingSphere();
      return g;
    };
    return { near: build(nearTris), far: build(farTris) };
  }

  async _loadGLBGeometry(url) {
    const gltf = await this._gltf.loadAsync(url);
    let geom = null;
    gltf.scene.updateWorldMatrix(true, true);
    gltf.scene.traverse(o => {
      if (geom || !o.isMesh || !o.geometry) return;
      const g = o.geometry.clone();
      // bake any node transform the exporter left on the mesh into the geometry
      o.updateWorldMatrix(true, false);
      g.applyMatrix4(o.matrixWorld);
      if (!g.attributes.normal) g.computeVertexNormals();
      geom = g;
    });
    if (!geom) throw new Error(`no mesh in ${url}`);
    return geom;
  }

  /**
   * Runtime "Import CAD…" helper. Parses a user-supplied file into a single
   * THREE.BufferGeometry (meters assumed; caller may rescale). Supports
   * GLB/GLTF/STL directly and STEP/STP via a lazily-imported OpenCascade WASM
   * build (best effort — the offline converter is the supported path for
   * articulated multi-link arms). Returns { geometry, name }.
   */
  async importFile(file) {
    const name = file.name || 'imported';
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'glb' || ext === 'gltf') {
      const url = URL.createObjectURL(file);
      try { return { geometry: await this._loadGLBGeometry(url), name }; }
      finally { URL.revokeObjectURL(url); }
    }
    if (ext === 'stl') {
      const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
      const buf = await file.arrayBuffer();
      const g = new STLLoader().parse(buf);
      const { mergeVertices } = await import('three/addons/utils/BufferGeometryUtils.js');
      const merged = mergeVertices(g);
      merged.computeVertexNormals();
      return { geometry: merged, name };
    }
    if (ext === 'step' || ext === 'stp') {
      return { geometry: await this._importStep(file), name };
    }
    throw new Error(`Unsupported CAD format: .${ext}`);
  }

  async _importStep(file) {
    // Lazy, off the critical path: OpenCascade WASM from the CDN. If this
    // environment blocks it, the caller catches and keeps the app usable.
    const occtimportjs = (await import('https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js')).default;
    const occt = await occtimportjs();
    const buf = new Uint8Array(await file.arrayBuffer());
    const result = occt.ReadStepFile(buf, null);
    if (!result || !result.success || !result.meshes.length) {
      throw new Error('STEP parse produced no meshes');
    }
    // merge all solids into one geometry, mm -> m
    const positions = [];
    const normals = [];
    const indices = [];
    let base = 0;
    for (const m of result.meshes) {
      const p = m.attributes.position.array;
      const n = m.attributes.normal ? m.attributes.normal.array : null;
      for (let i = 0; i < p.length; i += 3) {
        positions.push(p[i] * 0.001, p[i + 1] * 0.001, p[i + 2] * 0.001);
        if (n) normals.push(n[i], n[i + 1], n[i + 2]);
      }
      const idx = m.index ? m.index.array : null;
      const vcount = p.length / 3;
      if (idx) for (let i = 0; i < idx.length; i++) indices.push(idx[i] + base);
      else for (let i = 0; i < vcount; i++) indices.push(base + i);
      base += vcount;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (normals.length === positions.length) {
      g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    }
    g.setIndex(indices);
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  }
}

export const MeshLibrary = new _MeshLibrary();
