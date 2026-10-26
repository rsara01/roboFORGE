// RS STEP -> FAITHFUL per-link coloured GLBs + manifest.json  (v3 converter)
//
// Unlike convert.js/convert2.js this does NOT unfold the arm into a straight
// vertical stack. Each link mesh is baked in its REAL CAD orientation (only
// translated so its joint pivot sits at the local origin, and scaled mm->m), so
// the assembled arm keeps its true shape — the parts mate exactly like the STL.
//
// The manifest carries a real kinematic frame per joint:
//   * axis        — unit rotation axis in the CAD/base frame (Y-up)
//   * parentOffset — vector (m) from the parent joint's pivot to this pivot
//   * tipOffset    — vector (m) from this pivot to the NEXT pivot (or, for j6,
//                    to the gripper grasp point)
// robot.js rotates each joint about `axis` at its pivot and lays children out
// along `tipOffset`, reproducing the CAD assembly at the zero pose.
//
// The gripper (j6) additionally tags its two sliding jaws as fingerUp/fingerDown
// (material name "colorKey|role") so the gripper can open/close.
//
// Usage: node convert3.js <step> <outDir> [deflectionMM] [angular]
const fs = require('fs');
const path = require('path');
const occtimportjs = require('occt-import-js');

const STEP = process.argv[2];
const OUT  = process.argv[3];
const LDEF = parseFloat(process.argv[4] || '1.2');
const ADEF = parseFloat(process.argv[5] || '0.9');

// pivots (mm, CAD, Y-up)
const JOINT_ORIGIN = {
  base: [0, 0, 0], j1: [0, 75, 0], j2: [-20, 145, -8], j3: [216, 145, 0],
  j4: [-12, 217.7, 0], j5: [-99, 217.7, 0], j6: [-158, 217.7, 0],
};
const MOTOR_ANCHOR = { ...JOINT_ORIGIN, base: [0, 42, 0] };
const MOTOR_R = 50;
const CHAIN = ['base', 'j1', 'j2', 'j3', 'j4', 'j5', 'j6'];

// Real joint axes (unit, CAD frame). J1 yaw=Y; J2/J3/J5 pitch=Z (arm swings in
// the X-Y plane); J4 roll along the forearm (J3->J4); J6 roll along the gripper
// (J5->J6, i.e. -X). Signs are refined empirically in the app.
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
// Spherical wrist = roll(J4) · pitch(J5) · roll(J6). A roll axis must pass
// through the NEXT pivot so the child stays on-axis. J4→J5 and J5→J6 are both
// along −X (Y=217.7, Z=0), so J4 and J6 roll about −X and J5 pitches about Z.
// Wrist is pitch(J4) · yaw(J5) · roll(J6), per the reBot motor placement.
const AXES = {
  j1: [0, 1, 0],   // base yaw
  j2: [0, 0, 1],   // shoulder pitch
  j3: [0, 0, 1],   // elbow pitch
  j4: [0, 0, 1],   // wrist pitch  (nod up/down, about Z)
  j5: [0, 1, 0],   // wrist yaw    (turn left/right, about Y)
  j6: [-1, 0, 0],  // gripper roll (spin about the tool axis)
};
// Self-collision capsule radii (m). Deliberately slim: the FAITHFUL build keeps
// the real compact geometry, so the fatter proxies used for the old straight
// stack would flag the arm's own valid folded pose as a collision.
const RADII = { base: 0.065, j1: 0.030, j2: 0.031, j3: 0.033, j4: 0.019, j5: 0.018, j6: 0.017 };

const ASM_TO_LINK = {
  '01-BASE_ASM': 'base', '02-RS-LINK-1_ASM': 'j1', '03-RS-LINK-2_ASM': 'j2',
  '04-RS-LINK-3_ASM': 'j3', '05-RS-LINK-4_ASM': 'j4', '06-RS-LINK-5_ASM': 'j5',
  '07-RS-GRIPPER_ASM': 'j6', '2-LINK-4_5-R': 'j4', '2-LINK-4_5-L': 'j4',
};
// 6-SILICONE (the rubber grip pads) is kept — it fills the gap between the jaws.
// 9-M-RS00 is kept too: despite the "9-" (hardware) prefix it is the RS00 servo
// MODULE — the black drum that is the structural body of joints 4/5/6. Dropping
// it left the wrist links floating with visible gaps between them (j5→j6 was
// 26 mm of empty air, and link 4's end cap hung unattached).
const SKIP_RE = /^(7-HM|7-KA|7-KM|9-XT30|9-SOCKET|9-M-RS(?!00)|6-BEARING|6-THRUST|2-CD)/i;

// Green-and-black scheme (baked as GLB fallback; robot.js drives the live colour
// from RS_COLORS in main.js, which mirrors these).
const PALETTE = {
  revolute: 0x18191b, link: 0x2ea043, linkDark: 0x232427, base: 0x131416, bolt: 0x0e0f10,
};
const rgb = hex => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, 1];
const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

function colorKeyFor(link, name, c) {
  const n = (name || '').toUpperCase();
  if (/RACK|GEAR|RAIL|JAW|FINGER|SLIDER|CLAW/.test(n)) return 'linkDark';
  if (/RSM|STATOR|ROTOR|RORATOR|-M-RS|-M6|-M7|\bM6\b|\bM7\b|MOTOR/.test(n)) return 'revolute';
  if (link === 'base') return 'base';
  const a = MOTOR_ANCHOR[link] || JOINT_ORIGIN[link];
  if (Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]) <= MOTOR_R) return 'revolute';
  return 'link';
}

(async () => {
  const occt = await occtimportjs();
  console.error('reading STEP…');
  const res = occt.ReadStepFile(new Uint8Array(fs.readFileSync(STEP)), {
    linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: LDEF, angularDeflection: ADEF,
  });
  if (!res.success) { console.error('read failed'); process.exit(1); }
  console.error(`read ok meshes=${res.meshes.length}`);

  const meshLink = {};
  (function walk(node, cur) {
    let link = cur;
    if (node.name && ASM_TO_LINK[node.name] !== undefined) link = ASM_TO_LINK[node.name];
    if (node.meshes) for (const mi of node.meshes) if (meshLink[mi] === undefined) meshLink[mi] = link;
    if (node.children) for (const c of node.children) walk(c, link);
  })(res.root, null);

  const centroid = p => { let x = 0, y = 0, z = 0, n = p.length / 3; for (let i = 0; i < p.length; i += 3) { x += p[i]; y += p[i + 1]; z += p[i + 2]; } return [x / n, y / n, z / n]; };

  // groups[link][groupKey] = { pos, nrm, idx, colorKey, role }
  const groups = {};
  for (const L of CHAIN) groups[L] = {};
  const addTo = (L, gkey, colorKey, role, p, n) => {
    const g = (groups[L][gkey] = groups[L][gkey] || { pos: [], nrm: [], idx: [], colorKey, role });
    const base = g.pos.length / 3;
    for (let i = 0; i < p.length; i++) { g.pos.push(p[i]); g.nrm.push(n ? n[i] : 0); }
    return base;
  };

  let kept = 0, skipped = 0;
  res.meshes.forEach((m, mi) => {
    const L = meshLink[mi]; if (L == null) return;
    if (m.name && SKIP_RE.test(m.name)) { skipped++; return; }
    kept++;
    const p = m.attributes.position.array;
    const n = m.attributes.normal ? m.attributes.normal.array : null;
    const c = centroid(p);
    let colorKey = colorKeyFor(L, m.name, c);
    let role = 'static';
    let gkey = colorKey;
    // The RS00 servo drum is one 48k-tri solid per wrist joint — by far the
    // heaviest thing in the arm and a smooth black cylinder that survives hard
    // decimation. Give it its own primitive (same colour key, role 'module') so
    // decimate.js can thin it down without touching the detailed structure.
    if (/^9-M-RS00/i.test(m.name || '')) { role = 'module'; gkey = 'module_' + colorKey; }
    // Gripper finger split. The rack-and-pinion drives the two jaws apart along
    // the gripper's local Z (racks/clips/sliders sit at cZ = ±10..25; the motor,
    // pinion gear and slide rails are Z-centred and stay static).
    if (L === 'j6') {
      const cz = c[2] - JOINT_ORIGIN.j6[2];   // local Z (pivot Z = 0)
      const isPad = /SILICONE/i.test(m.name || '');
      // Jaw bodies sit at cZ = ±13; the rubber pads sit at ±1 (inner faces) — both
      // belong to the jaw on their side, so pads split by sign, bodies by ±5.
      const side = isPad ? (cz > 0 ? 1 : -1) : (cz > 5 ? 1 : (cz < -5 ? -1 : 0));
      if (side !== 0) {
        role = side > 0 ? 'fingerA' : 'fingerB';
        colorKey = isPad ? 'bolt' : 'link';   // green jaws, black rubber pads
        gkey = role + '_' + colorKey;
      }
    }
    const idxBase = addTo(L, gkey, colorKey, role, p, n);
    const g = groups[L][gkey];
    const idx = m.index ? m.index.array : null;
    if (idx) for (let i = 0; i < idx.length; i++) g.idx.push(idx[i] + idxBase);
    else for (let i = 0; i < p.length / 3; i++) g.idx.push(idxBase + i);
  });
  console.error(`kept ${kept} skipped ${skipped}`);

  fs.mkdirSync(OUT, { recursive: true });
  const prevPath = path.join(OUT, 'manifest.json');
  const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : { links: [] };
  const prevById = {}; for (const l of prev.links) prevById[l.id] = l;

  const manifest = {
    name: 'RS', source: path.basename(STEP), units: 'm', upAxis: 'Y', frame: 'real',
    note: 'FAITHFUL build: links baked in real CAD orientation (no unfold). Per-joint axis + parentOffset + tipOffset drive robot.js. Material name = "colorKey|role"; role fingerUp/fingerDown are the sliding jaws.',
    links: [],
  };

  let totalTris = 0;
  for (let ci = 0; ci < CHAIN.length; ci++) {
    const L = CHAIN[ci];
    const byKey = groups[L];
    if (!Object.keys(byKey).length) { console.error(`WARN ${L} empty`); continue; }
    const O = JOINT_ORIGIN[L];

    const prims = [];
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    let maxR = 0;
    const partsMeta = [];
    for (const gkey of Object.keys(byKey)) {
      const g = byKey[gkey];
      const P = new Float32Array(g.pos.length), N = new Float32Array(g.nrm.length);
      const pbb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i < g.pos.length; i += 3) {
        // translate to pivot-local, scale mm->m, NO rotation (real orientation)
        const v = [(g.pos[i] - O[0]) / 1000, (g.pos[i + 1] - O[1]) / 1000, (g.pos[i + 2] - O[2]) / 1000];
        P[i] = v[0]; P[i + 1] = v[1]; P[i + 2] = v[2];
        for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], v[k]); bb[k + 3] = Math.max(bb[k + 3], v[k]); pbb[k] = Math.min(pbb[k], v[k]); pbb[k + 3] = Math.max(pbb[k + 3], v[k]); }
        maxR = Math.max(maxR, Math.hypot(v[0], v[1], v[2]));
        N[i] = g.nrm[i]; N[i + 1] = g.nrm[i + 1]; N[i + 2] = g.nrm[i + 2];
      }
      const I = new Uint32Array(g.idx);
      const matName = g.role && g.role !== 'static' ? `${g.colorKey}|${g.role}` : g.colorKey;
      prims.push({ P, N, I, bb: pbb, colorKey: g.colorKey, matName, color: rgb(PALETTE[g.colorKey] || 0xc9d4e0) });
      partsMeta.push({ colorKey: g.colorKey, role: g.role, tris: I.length / 3 });
      totalTris += I.length / 3;
    }

    const file = `rs_${L}.glb`;
    writeGLB(path.join(OUT, file), prims);

    // kinematic frame
    const nextL = CHAIN[ci + 1];
    let tipOffset;
    if (L === 'base') tipOffset = sub3(JOINT_ORIGIN.j1, O).map(v => round(v / 1000, 5));
    else if (nextL) tipOffset = sub3(JOINT_ORIGIN[nextL], O).map(v => round(v / 1000, 5));
    else tipOffset = [round((bb[0]) * 0.9, 5), 0, 0]; // gripper grasp point (toward jaws, -X)
    const parentOffset = ci === 0 ? [0, 0, 0]
      : sub3(JOINT_ORIGIN[L], JOINT_ORIGIN[CHAIN[ci - 1]]).map(v => round(v / 1000, 5));

    const p = prevById[L] || {};
    manifest.links.push({
      id: L, file, tris: prims.reduce((s, x) => s + x.I.length / 3, 0),
      axis: L === 'base' ? null : AXES[L],
      parentOffset, tipOffset,
      collisionRadius: RADII[L] ?? round(Math.max(0.03, maxR * 0.4), 4),
      min: L === 'base' ? null : (L === 'j1' ? -3.14 : -2.3),
      max: L === 'base' ? null : (L === 'j1' ? 3.14 : 2.3),
      parts: partsMeta,
      aabb: bb.map(v => round(v, 4)),
    });
    console.error(`${L}: parts=${partsMeta.map(x => (x.role !== 'static' ? x.role : x.colorKey) + ':' + x.tris).join(' ')} tip=[${tipOffset}]`);
  }
  manifest.totalTris = totalTris;
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.error(`TOTAL tris=${totalTris} -> ${OUT}`);
})();

function writeGLB(file, prims) {
  const pad4 = n => (4 - (n % 4)) % 4;
  const views = []; const chunks = []; let off = 0;
  const pushView = (buf, target) => {
    const pad = pad4(off); if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
    const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength); chunks.push(b);
    views.push({ byteOffset: off, byteLength: b.length, target }); off += b.length; return views.length - 1;
  };
  const accessors = [], materials = [], meshPrims = [];
  for (const pr of prims) {
    const iv = pushView(pr.I, 34963), pv = pushView(pr.P, 34962), nv = pushView(pr.N, 34962);
    const ai = accessors.push({ bufferView: iv, componentType: 5125, count: pr.I.length, type: 'SCALAR' }) - 1;
    const ap = accessors.push({ bufferView: pv, componentType: 5126, count: pr.P.length / 3, type: 'VEC3', min: [pr.bb[0], pr.bb[1], pr.bb[2]], max: [pr.bb[3], pr.bb[4], pr.bb[5]] }) - 1;
    const an = accessors.push({ bufferView: nv, componentType: 5126, count: pr.N.length / 3, type: 'VEC3' }) - 1;
    const mi = materials.push({ name: pr.matName, pbrMetallicRoughness: { baseColorFactor: pr.color, metallicFactor: 0.55, roughnessFactor: 0.42 } }) - 1;
    meshPrims.push({ attributes: { POSITION: ap, NORMAL: an }, indices: ai, material: mi, mode: 4 });
  }
  const bin = Buffer.concat(chunks);
  const json = { asset: { version: '2.0', generator: 'rsconv3' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: meshPrims }], materials, accessors,
    bufferViews: views.map(v => ({ buffer: 0, byteOffset: v.byteOffset, byteLength: v.byteLength, target: v.target })),
    buffers: [{ byteLength: bin.length }] };
  let js = JSON.stringify(json); js += ' '.repeat(pad4(Buffer.byteLength(js)));
  const jb = Buffer.from(js, 'utf8'); const total = 12 + 8 + jb.length + 8 + bin.length;
  const out = Buffer.alloc(total); let o = 0;
  out.writeUInt32LE(0x46546C67, o); o += 4; out.writeUInt32LE(2, o); o += 4; out.writeUInt32LE(total, o); o += 4;
  out.writeUInt32LE(jb.length, o); o += 4; out.writeUInt32LE(0x4E4F534A, o); o += 4; jb.copy(out, o); o += jb.length;
  out.writeUInt32LE(bin.length, o); o += 4; out.writeUInt32LE(0x004E4942, o); o += 4; bin.copy(out, o);
  fs.writeFileSync(file, out);
}
