// Deep inspect: per link, list solids with name, centroid, AABB, tris.
// Identify motor (RSM) module centroids => candidate joint pivots.
const fs = require('fs');
const occtimportjs = require('occt-import-js');
const STEP = process.argv[2];

const ASM_TO_LINK = {
  '01-BASE_ASM': 'base', '02-RS-LINK-1_ASM': 'j1', '03-RS-LINK-2_ASM': 'j2',
  '04-RS-LINK-3_ASM': 'j3', '05-RS-LINK-4_ASM': 'j4', '06-RS-LINK-5_ASM': 'j5',
  '07-RS-GRIPPER_ASM': 'j6',
};

(async () => {
  const occt = await occtimportjs();
  const buf = fs.readFileSync(STEP);
  console.error('reading…');
  const res = occt.ReadStepFile(new Uint8Array(buf), {
    linearUnit: 'millimeter', linearDeflectionType: 'absolute_value',
    linearDeflection: 3.0, angularDeflection: 1.0,
  });
  if (!res.success) process.exit(1);
  console.error('meshes=' + res.meshes.length);

  const meshLink = {};
  function walk(node, cur) {
    let link = cur;
    if (node.name && ASM_TO_LINK[node.name] !== undefined) link = ASM_TO_LINK[node.name];
    if (node.meshes) for (const mi of node.meshes) if (meshLink[mi] === undefined) meshLink[mi] = link;
    if (node.children) for (const c of node.children) walk(c, link);
  }
  walk(res.root, null);

  function stat(m) {
    const p = m.attributes.position.array;
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    let cx = 0, cy = 0, cz = 0, n = p.length / 3;
    for (let i = 0; i < p.length; i += 3) {
      bb[0] = Math.min(bb[0], p[i]); bb[1] = Math.min(bb[1], p[i + 1]); bb[2] = Math.min(bb[2], p[i + 2]);
      bb[3] = Math.max(bb[3], p[i]); bb[4] = Math.max(bb[4], p[i + 1]); bb[5] = Math.max(bb[5], p[i + 2]);
      cx += p[i]; cy += p[i + 1]; cz += p[i + 2];
    }
    const tris = (m.index ? m.index.array.length : p.length / 3) / 3;
    return { c: [cx / n, cy / n, cz / n], bb, tris };
  }

  const links = {};
  res.meshes.forEach((m, mi) => {
    const L = meshLink[mi] || 'UNMAPPED';
    links[L] = links[L] || [];
    links[L].push({ name: m.name || '(unnamed)', ...stat(m) });
  });

  const f1 = v => v.toFixed(0);
  for (const L of ['base', 'j1', 'j2', 'j3', 'j4', 'j5', 'j6']) {
    if (!links[L]) continue;
    const solids = links[L].sort((a, b) => b.tris - a.tris);
    console.log(`\n=== ${L} (${solids.length} solids) ===`);
    // motor solids
    const motor = solids.filter(s => /RSM|STATOR|RORATOR|ROTATOR|MOTOR/i.test(s.name));
    if (motor.length) {
      const mb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const s of motor) for (let k = 0; k < 3; k++) { mb[k] = Math.min(mb[k], s.bb[k]); mb[k + 3] = Math.max(mb[k + 3], s.bb[k + 3]); }
      const ctr = [(mb[0] + mb[3]) / 2, (mb[1] + mb[4]) / 2, (mb[2] + mb[5]) / 2];
      console.log(`  MOTOR parts=${motor.length} bboxCtr=[${ctr.map(f1)}] bbox=[${mb.map(f1)}]`);
      console.log(`    names: ${[...new Set(motor.map(s => s.name.replace(/[-_]?\d+$/, '')))].join(', ')}`);
    }
    // top named solids
    for (const s of solids.slice(0, 12)) {
      console.log(`  ${s.tris.toString().padStart(6)}t  c=[${s.c.map(f1).join(',')}]  ${s.name}`);
    }
  }
})();
