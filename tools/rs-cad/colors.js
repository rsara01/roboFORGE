// Inspect RS STEP: per-link color palette. Coarse deflection (fast) — we only
// care about the color field + which sub-assembly each solid belongs to.
const fs = require('fs');
const occtimportjs = require('occt-import-js');

const STEP = process.argv[2];

const ASM_TO_LINK = {
  '01-BASE_ASM': 'base',
  '02-RS-LINK-1_ASM': 'j1',
  '03-RS-LINK-2_ASM': 'j2',
  '04-RS-LINK-3_ASM': 'j3',
  '05-RS-LINK-4_ASM': 'j4',
  '06-RS-LINK-5_ASM': 'j5',
  '07-RS-GRIPPER_ASM': 'j6',
};

const hex = (c) => c ? '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('') : 'null';

(async () => {
  const occt = await occtimportjs();
  const buf = fs.readFileSync(STEP);
  console.error('reading STEP (coarse)…');
  const t0 = Date.now();
  const res = occt.ReadStepFile(new Uint8Array(buf), {
    linearUnit: 'millimeter',
    linearDeflectionType: 'absolute_value',
    linearDeflection: 3.0,
    angularDeflection: 1.0,
  });
  if (!res.success) { console.error('read failed'); process.exit(1); }
  console.error(`read ok ${((Date.now() - t0) / 1000).toFixed(1)}s meshes=${res.meshes.length}`);

  // meshIndex -> link id
  const meshLink = {};
  function walk(node, curLink) {
    let link = curLink;
    if (node.name && ASM_TO_LINK[node.name] !== undefined) link = ASM_TO_LINK[node.name];
    if (node.meshes) for (const mi of node.meshes) if (meshLink[mi] === undefined) meshLink[mi] = link;
    if (node.children) for (const c of node.children) walk(c, link);
  }
  walk(res.root, null);

  // per link: color -> { count, tris, names:Set }
  const perLink = {};
  res.meshes.forEach((m, mi) => {
    const L = meshLink[mi] || 'UNMAPPED';
    const p = m.attributes.position.array;
    const tris = (m.index ? m.index.array.length : p.length / 3) / 3;
    const key = hex(m.color);
    perLink[L] = perLink[L] || {};
    const slot = perLink[L][key] = perLink[L][key] || { count: 0, tris: 0, names: new Set() };
    slot.count++; slot.tris += tris;
    if (m.name) slot.names.add(m.name.replace(/[-_]?\d+$/, ''));
  });

  const order = ['base', 'j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'UNMAPPED'];
  for (const L of order) {
    if (!perLink[L]) continue;
    console.log(`\n=== ${L} ===`);
    const entries = Object.entries(perLink[L]).sort((a, b) => b[1].tris - a[1].tris);
    for (const [color, s] of entries) {
      const names = [...s.names].slice(0, 6).join(', ');
      console.log(`  ${color}  solids=${s.count}  tris=${Math.round(s.tris)}  e.g. ${names}`);
    }
  }

  // global palette
  const global = {};
  res.meshes.forEach(m => {
    const key = hex(m.color);
    const p = m.attributes.position.array;
    const tris = (m.index ? m.index.array.length : p.length / 3) / 3;
    global[key] = (global[key] || 0) + tris;
  });
  console.log('\n=== GLOBAL PALETTE (by tri area) ===');
  for (const [c, t] of Object.entries(global).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}  tris=${Math.round(t)}`);
  }
})();
