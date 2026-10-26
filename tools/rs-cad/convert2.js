// RS STEP -> per-link COLORED multi-material GLB + manifest.json  (v2 converter)
//
// Improvements over convert.js:
//   * Each link is split into material groups (motor / structure / gripper /
//     hardware / base) by part name + proximity to the joint pivot, and written
//     as a multi-primitive GLB (one material per group). This is what gives the
//     arm real colors instead of one flat gray blob.
//   * The gripper link (j6) is UNFOLDED along its wrist->grip direction so it
//     points +Y like every other link, and its linkLength is set to the grasp
//     point, so a mounted end effector sits flush at the jaws.
//   * The hand-tuned kinematic/collision fields (jointAxis, linkAxis, min/max,
//     collisionRadius) from the existing manifest are PRESERVED — only geometry,
//     colors, per-link `parts`, and j6's linkLength/aabb are regenerated.
//
// Usage: node convert2.js <step> <outDir> [deflectionMM] [angular]
const fs = require('fs');
const path = require('path');
const occtimportjs = require('occt-import-js');

const STEP = process.argv[2];
const OUT  = process.argv[3];
const LDEF = parseFloat(process.argv[4] || '0.6');
const ADEF = parseFloat(process.argv[5] || '0.8');

// ---- joint pivots (mm, world, Y-up) — must match convert.js / manifest ----
const JOINT_ORIGIN = {
  base: [0, 0, 0], j1: [0, 75, 0], j2: [-20, 145, -8], j3: [216, 145, 0],
  j4: [-12, 217.7, 0], j5: [-99, 217.7, 0], j6: [-158, 217.7, 0],
};
// where the driving motor sits (for the blue "motor collar" proximity test)
const MOTOR_ANCHOR = { ...JOINT_ORIGIN, base: [0, 42, 0] };
const MOTOR_R = 50; // mm: solids within this of the anchor read as motor

const ASM_TO_LINK = {
  '01-BASE_ASM': 'base', '02-RS-LINK-1_ASM': 'j1', '03-RS-LINK-2_ASM': 'j2',
  '04-RS-LINK-3_ASM': 'j3', '05-RS-LINK-4_ASM': 'j4', '06-RS-LINK-5_ASM': 'j5',
  '07-RS-GRIPPER_ASM': 'j6', '2-LINK-4_5-R': 'j4', '2-LINK-4_5-L': 'j4',
};
const CHAIN = ['base', 'j1', 'j2', 'j3', 'j4', 'j5', 'j6'];
const LINK_AXIS = { j1: '+y', j2: '+y', j3: '+y', j4: '+y', j5: '+y', j6: '+y' };
const AXIS_VEC = { '+y': [0, 1, 0], '-y': [0, -1, 0], '+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };

// same skip filter as convert.js so kept geometry (and tri budget) is unchanged
const SKIP_RE = /^(7-HM|7-KA|7-KM|9-XT30|9-SOCKET|9-M-RS|6-BEARING|6-THRUST|2-CD|6-SILICONE)/i;

// ---- colour palette: keys mirror robot.js DEFAULT_COLORS so the app's colour
//      pickers keep working (material.name carries the key back to the runtime) ----
const PALETTE = {
  revolute:     0x4ea1ff, // motors / joint modules
  revoluteDark: 0x1f4a7a,
  link:         0xc9d4e0, // structural links
  linkDark:     0x6a7686, // gripper mechanism (racks/gears/rails)
  base:         0x556677, // pedestal
  bolt:         0x2a2f36, // dark hardware / grip pads
};
function rgb(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, 1]; }

function colorKeyFor(link, name, c) {
  const n = (name || '').toUpperCase();
  if (/RACK|GEAR|RAIL|JAW|FINGER|SLIDER|CLAW/.test(n)) return 'linkDark';   // gripper mech
  if (/RSM|STATOR|ROTOR|RORATOR|-M6|-M7|\bM6\b|\bM7\b|MOTOR/.test(n)) return 'revolute';
  if (link === 'base') {
    // Only the named motor bits read blue; the pedestal stays base-coloured.
    // (proximity would swallow the whole small base.)
    return 'base';
  }
  const a = MOTOR_ANCHOR[link] || JOINT_ORIGIN[link];
  if (Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]) <= MOTOR_R) return 'revolute';
  return 'link';
}

// ---- vec / quat helpers (unchanged from convert.js) ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = v => Math.hypot(v[0], v[1], v[2]);
const nrm = v => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function quatFromTo(a, b) {
  a = nrm(a); b = nrm(b); let d = dot(a, b);
  if (d < -0.999999) { let ax = cross([1, 0, 0], a); if (len(ax) < 1e-6) ax = cross([0, 1, 0], a); ax = nrm(ax); return [ax[0], ax[1], ax[2], 0]; }
  const c = cross(a, b); const w = 1 + d; const q = [c[0], c[1], c[2], w]; const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
function applyQuat(v, q) {
  const [x, y, z] = v, [qx, qy, qz, qw] = q;
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}
const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

(async () => {
  const occt = await occtimportjs();
  const buf = fs.readFileSync(STEP);
  console.error('reading STEP…');
  const res = occt.ReadStepFile(new Uint8Array(buf), {
    linearUnit: 'millimeter', linearDeflectionType: 'absolute_value',
    linearDeflection: LDEF, angularDeflection: ADEF,
  });
  if (!res.success) { console.error('read failed'); process.exit(1); }
  console.error(`read ok meshes=${res.meshes.length}`);

  // meshIndex -> link id
  const meshLink = {};
  (function walk(node, cur) {
    let link = cur;
    if (node.name && ASM_TO_LINK[node.name] !== undefined) link = ASM_TO_LINK[node.name];
    if (node.meshes) for (const mi of node.meshes) if (meshLink[mi] === undefined) meshLink[mi] = link;
    if (node.children) for (const c of node.children) walk(c, link);
  })(res.root, null);

  const centroid = (p) => { let x = 0, y = 0, z = 0, n = p.length / 3; for (let i = 0; i < p.length; i += 3) { x += p[i]; y += p[i + 1]; z += p[i + 2]; } return [x / n, y / n, z / n]; };

  // groups[link][colorKey] = { pos:[], nrm:[], idx:[] }
  const groups = {};
  for (const L of CHAIN) groups[L] = {};
  let skipped = 0, kept = 0;
  res.meshes.forEach((m, mi) => {
    const L = meshLink[mi]; if (L == null) return;
    if (m.name && SKIP_RE.test(m.name)) { skipped++; return; }
    kept++;
    const p = m.attributes.position.array;
    const n = m.attributes.normal ? m.attributes.normal.array : null;
    const key = colorKeyFor(L, m.name, centroid(p));
    const g = (groups[L][key] = groups[L][key] || { pos: [], nrm: [], idx: [] });
    const base = g.pos.length / 3;
    for (let i = 0; i < p.length; i++) { g.pos.push(p[i]); g.nrm.push(n ? n[i] : 0); }
    const idx = m.index ? m.index.array : null;
    if (idx) for (let i = 0; i < idx.length; i++) g.idx.push(idx[i] + base);
    else for (let i = 0; i < p.length / 3; i++) g.idx.push(base + i);
  });
  console.error(`kept ${kept} solids, skipped ${skipped}`);

  fs.mkdirSync(OUT, { recursive: true });

  // preserve tuned fields from the existing manifest if present
  const prevPath = path.join(OUT, 'manifest.json');
  const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : { links: [] };
  const prevById = {}; for (const l of prev.links) prevById[l.id] = l;

  const manifest = {
    name: 'RS', source: path.basename(STEP), units: 'm', upAxis: 'Y',
    note: 'Baked to meters, Y-up. Each link mesh origin = its joint axis; canonical zero pose = straight +Y stack. Multi-material: each primitive material.name is a robot.js colour key.',
    links: [],
  };

  let totalTris = 0;
  for (let ci = 0; ci < CHAIN.length; ci++) {
    const L = CHAIN[ci];
    const byKey = groups[L];
    if (!Object.keys(byKey).length) { console.error(`WARN ${L} empty`); continue; }
    const O = JOINT_ORIGIN[L];
    let q = [0, 0, 0, 1], linkAxis = null, linkLength = null;
    if (L !== 'base') {
      linkAxis = LINK_AXIS[L] || '+y';
      const nextL = CHAIN[ci + 1];
      if (nextL) {
        const worldDir = sub(JOINT_ORIGIN[nextL], O);
        linkLength = len(worldDir) / 1000;
        q = quatFromTo(worldDir, AXIS_VEC[linkAxis]);
      } else {
        // gripper: unfold along the wrist->grip principal direction so the jaws
        // point +Y. Grip direction = from the pivot toward the mean of the far
        // (gripper-mechanism) geometry.
        const grip = byKey.linkDark || byKey.link;
        let gd = [-1, 0, 0];
        if (grip && grip.pos.length) {
          const c = centroid(grip.pos); gd = sub(c, O); if (len(gd) < 1e-3) gd = [-1, 0, 0];
        }
        q = quatFromTo(gd, AXIS_VEC['+y']);
      }
    }

    // bake every colour group with the same per-link transform
    const prims = [];
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    let maxR = 0;
    const partsMeta = [];
    for (const key of Object.keys(byKey)) {
      const g = byKey[key];
      const P = new Float32Array(g.pos.length), N = new Float32Array(g.nrm.length);
      const pbb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i < g.pos.length; i += 3) {
        let v = applyQuat([g.pos[i] - O[0], g.pos[i + 1] - O[1], g.pos[i + 2] - O[2]], q);
        v = [v[0] / 1000, v[1] / 1000, v[2] / 1000];
        P[i] = v[0]; P[i + 1] = v[1]; P[i + 2] = v[2];
        for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], v[k]); bb[k + 3] = Math.max(bb[k + 3], v[k]); pbb[k] = Math.min(pbb[k], v[k]); pbb[k + 3] = Math.max(pbb[k + 3], v[k]); }
        const r = Math.hypot(v[0], v[2]); if (r > maxR) maxR = r;
        let nn = applyQuat([g.nrm[i], g.nrm[i + 1], g.nrm[i + 2]], q);
        N[i] = nn[0]; N[i + 1] = nn[1]; N[i + 2] = nn[2];
      }
      const I = new Uint32Array(g.idx);
      prims.push({ P, N, I, bb: pbb, colorKey: key, color: rgb(PALETTE[key]) });
      partsMeta.push({ colorKey: key, tris: I.length / 3 });
      totalTris += I.length / 3;
    }

    const file = `rs_${L}.glb`;
    writeGLB(path.join(OUT, file), prims);

    const p = prevById[L] || {};
    // j6 length = grasp point along +Y (jaw reach); others keep tuned length
    if (L === 'j6') linkLength = round(Math.max(0.03, bb[4] * 0.92), 4);
    const entry = {
      id: L, file, tris: prims.reduce((s, x) => s + x.I.length / 3, 0),
      jointAxis: p.jointAxis !== undefined ? p.jointAxis : (L === 'base' ? null : 'x'),
      linkAxis: p.linkAxis !== undefined ? p.linkAxis : linkAxis,
      linkLength: (L === 'j6') ? linkLength : (p.linkLength !== undefined ? p.linkLength : (linkLength != null ? round(linkLength, 4) : null)),
      collisionRadius: p.collisionRadius !== undefined ? p.collisionRadius : round(Math.max(0.03, maxR * 0.9), 4),
      min: p.min !== undefined ? p.min : (L === 'base' ? null : (L === 'j1' ? -3.14 : -2.3)),
      max: p.max !== undefined ? p.max : (L === 'base' ? null : (L === 'j1' ? 3.14 : 2.3)),
      parts: partsMeta,
      aabb: bb.map(v => round(v, 4)),
    };
    manifest.links.push(entry);
    console.error(`${L}: parts=${partsMeta.map(x => x.colorKey + ':' + x.tris).join(' ')} len=${entry.linkLength} aabbY=[${bb[1].toFixed(3)},${bb[4].toFixed(3)}]`);
  }
  manifest.totalTris = totalTris;
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.error(`TOTAL tris=${totalTris} -> ${OUT}`);
})();

// ---- multi-primitive GLB writer (POSITION, NORMAL, indices, per-prim material) ----
function writeGLB(file, prims) {
  const pad4 = (n) => (4 - (n % 4)) % 4;
  // build bin: for each prim -> idx, pos, nrm (each 4-aligned)
  const views = []; // {byteOffset, byteLength, target}
  const chunks = [];
  let off = 0;
  const pushView = (buf, target) => {
    const pad = pad4(off);
    if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
    const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    chunks.push(b);
    const view = { byteOffset: off, byteLength: b.length, target };
    off += b.length; views.push(view); return views.length - 1;
  };
  const accessors = [], materials = [], meshPrims = [];
  for (const pr of prims) {
    const idxView = pushView(pr.I, 34963);
    const posView = pushView(pr.P, 34962);
    const nrmView = pushView(pr.N, 34962);
    const aIdx = accessors.push({ bufferView: idxView, componentType: 5125, count: pr.I.length, type: 'SCALAR' }) - 1;
    const aPos = accessors.push({ bufferView: posView, componentType: 5126, count: pr.P.length / 3, type: 'VEC3', min: [pr.bb[0], pr.bb[1], pr.bb[2]], max: [pr.bb[3], pr.bb[4], pr.bb[5]] }) - 1;
    const aNrm = accessors.push({ bufferView: nrmView, componentType: 5126, count: pr.N.length / 3, type: 'VEC3' }) - 1;
    const mat = materials.push({
      name: pr.colorKey,
      pbrMetallicRoughness: { baseColorFactor: pr.color, metallicFactor: 0.55, roughnessFactor: 0.42 },
    }) - 1;
    meshPrims.push({ attributes: { POSITION: aPos, NORMAL: aNrm }, indices: aIdx, material: mat, mode: 4 });
  }
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', generator: 'rsconv2' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: meshPrims }],
    materials, accessors,
    bufferViews: views.map(v => ({ buffer: 0, byteOffset: v.byteOffset, byteLength: v.byteLength, target: v.target })),
    buffers: [{ byteLength: bin.length }],
  };
  let jsonStr = JSON.stringify(json);
  jsonStr += ' '.repeat(pad4(Buffer.byteLength(jsonStr)));
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  const out = Buffer.alloc(total); let o = 0;
  out.writeUInt32LE(0x46546C67, o); o += 4; out.writeUInt32LE(2, o); o += 4; out.writeUInt32LE(total, o); o += 4;
  out.writeUInt32LE(jsonBuf.length, o); o += 4; out.writeUInt32LE(0x4E4F534A, o); o += 4; jsonBuf.copy(out, o); o += jsonBuf.length;
  out.writeUInt32LE(bin.length, o); o += 4; out.writeUInt32LE(0x004E4942, o); o += 4; bin.copy(out, o);
  fs.writeFileSync(file, out);
}
