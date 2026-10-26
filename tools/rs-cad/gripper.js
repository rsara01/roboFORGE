// Detailed dump of the gripper (07-RS-GRIPPER) solids: name, centroid, bbox,
// tris — in the j6 pivot-local frame (mm) so we can design the finger split.
const fs = require('fs');
const occtimportjs = require('occt-import-js');
const STEP = process.argv[2];
const O = [-158, 217.7, 0]; // j6 pivot
const SKIP_RE = /^(7-HM|7-KA|7-KM|9-XT30|9-SOCKET|9-M-RS|6-BEARING|6-THRUST|2-CD|6-SILICONE)/i;

(async () => {
  const occt = await occtimportjs();
  const res = occt.ReadStepFile(new Uint8Array(fs.readFileSync(STEP)), {
    linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 2.0, angularDeflection: 1.0,
  });
  const meshLink = {};
  (function walk(n, cur) {
    let L = cur; if (n.name === '07-RS-GRIPPER_ASM') L = 'j6';
    if (n.meshes) for (const mi of n.meshes) if (meshLink[mi] === undefined) meshLink[mi] = L;
    if (n.children) for (const c of n.children) walk(c, L);
  })(res.root, null);

  const rows = [];
  res.meshes.forEach((m, mi) => {
    if (meshLink[mi] !== 'j6') return;
    if (m.name && SKIP_RE.test(m.name)) return;
    const p = m.attributes.position.array;
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    let cx = 0, cy = 0, cz = 0, n = p.length / 3;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] - O[0], y = p[i + 1] - O[1], z = p[i + 2] - O[2];
      cx += x; cy += y; cz += z;
      bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.min(bb[2], z);
      bb[3] = Math.max(bb[3], x); bb[4] = Math.max(bb[4], y); bb[5] = Math.max(bb[5], z);
    }
    rows.push({ name: m.name || '(unnamed)', c: [cx / n, cy / n, cz / n], bb, tris: (m.index ? m.index.array.length : p.length / 3) / 3 });
  });
  rows.sort((a, b) => b.tris - a.tris);
  const f = v => v.toFixed(0);
  console.log('local frame = j6 pivot; X=gripper reach dir(neg=jaws), Y=up, Z=side');
  for (const r of rows) {
    console.log(`${String(Math.round(r.tris)).padStart(6)}t  c=[${r.c.map(f).join(',')}]  bbX[${f(r.bb[0])},${f(r.bb[3])}] bbY[${f(r.bb[1])},${f(r.bb[4])}] bbZ[${f(r.bb[2])},${f(r.bb[5])}]  ${r.name}`);
  }
})();
