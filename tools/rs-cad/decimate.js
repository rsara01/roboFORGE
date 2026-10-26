// Weld + simplify RS GLBs in place (preserves per-primitive materials/colours).
// Usage: node decimate.js <dir> [ratio] [extraRatio] [matNameRegex]
//
// The optional third/fourth args run a SECOND, harder simplify pass over only
// the primitives whose material name matches — used for the RS00 servo drums
// (material "revolute|module"), which are smooth black cylinders carrying ~40%
// of the arm's triangles and no silhouette detail worth keeping.
const { NodeIO } = require('@gltf-transform/core');
const { weld, simplify, dedup } = require('@gltf-transform/functions');
const { MeshoptSimplifier } = require('meshoptimizer');
const fs = require('fs');
const path = require('path');

const DIR = process.argv[2];
const RATIO = parseFloat(process.argv[3] || '0.55');
const EXTRA = process.argv[4] ? parseFloat(process.argv[4]) : null;
const EXTRA_RE = new RegExp(process.argv[5] || '\\|module$');

(async () => {
  await MeshoptSimplifier.ready;
  const io = new NodeIO();
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.glb'));
  let before = 0, after = 0;
  for (const f of files) {
    const p = path.join(DIR, f);
    before += fs.statSync(p).size;
    const doc = await io.read(p);
    await doc.transform(
      // NB: do NOT dedup materials — the gripper's fingerUp/fingerDown share the
      // linkDark colour but carry distinct role names we must preserve.
      dedup({ propertyTypes: ['Accessor', 'Mesh', 'Texture', 'Skin'] }),
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.002, lockBorder: true }),
    );
    let note = '';
    if (EXTRA != null) {
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          if (!EXTRA_RE.test(prim.getMaterial()?.getName() || '')) continue;
          note += ` [${prim.getMaterial().getName()} ${simplifyPrim(prim, EXTRA)}]`;
        }
      }
    }
    await io.write(p, doc);
    const sz = fs.statSync(p).size;
    after += sz;
    console.log(`${f}: ${(sz / 1024).toFixed(0)} KB${note}`);
  }
  console.log(`TOTAL ${(before / 1e6).toFixed(1)}MB -> ${(after / 1e6).toFixed(1)}MB`);
})();

/** Extra simplify of one primitive, then compact away the orphaned vertices. */
function simplifyPrim(prim, ratio) {
  const idxAcc = prim.getIndices();
  const posAcc = prim.getAttribute('POSITION');
  if (!idxAcc || !posAcc) return 'skipped';
  const indices = new Uint32Array(idxAcc.getArray());
  const positions = new Float32Array(posAcc.getArray());
  const target = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3);
  const [dst] = MeshoptSimplifier.simplify(indices, positions, 3, target, 0.05);

  const remap = new Map();
  const newIdx = new Uint32Array(dst.length);
  for (let i = 0; i < dst.length; i++) {
    let n = remap.get(dst[i]);
    if (n === undefined) { n = remap.size; remap.set(dst[i], n); }
    newIdx[i] = n;
  }
  for (const semantic of prim.listSemantics()) {
    const acc = prim.getAttribute(semantic);
    const src = acc.getArray();
    const w = acc.getElementSize();
    const out = new src.constructor(remap.size * w);
    for (const [from, to] of remap) for (let k = 0; k < w; k++) out[to * w + k] = src[from * w + k];
    acc.setArray(out);
  }
  idxAcc.setArray(newIdx);
  return `${indices.length / 3} -> ${newIdx.length / 3} tris`;
}
