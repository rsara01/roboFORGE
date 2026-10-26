// Dump every STEP solid with its convert3 link assignment / skip flag / bbox to
// JSON so the assembled gaps can be queried offline.
const fs = require('fs');
const occtimportjs = require('occt-import-js');
const STEP = process.argv[2];
const OUT = process.argv[3] || '_dump.json';

const ASM_TO_LINK = {
  '01-BASE_ASM': 'base', '02-RS-LINK-1_ASM': 'j1', '03-RS-LINK-2_ASM': 'j2',
  '04-RS-LINK-3_ASM': 'j3', '05-RS-LINK-4_ASM': 'j4', '06-RS-LINK-5_ASM': 'j5',
  '07-RS-GRIPPER_ASM': 'j6', '2-LINK-4_5-R': 'j4', '2-LINK-4_5-L': 'j4',
};
const SKIP_RE = /^(7-HM|7-KA|7-KM|9-XT30|9-SOCKET|9-M-RS|6-BEARING|6-THRUST|2-CD)/i;

(async () => {
  const occt = await occtimportjs();
  console.error('reading…');
  const res = occt.ReadStepFile(new Uint8Array(fs.readFileSync(STEP)), {
    linearUnit: 'millimeter', linearDeflectionType: 'absolute_value',
    linearDeflection: 3.0, angularDeflection: 1.0,
  });
  if (!res.success) process.exit(1);

  const meshLink = {}, meshPath = {};
  (function walk(node, cur, path) {
    let link = cur;
    const p = node.name ? path.concat(node.name) : path;
    if (node.name && ASM_TO_LINK[node.name] !== undefined) link = ASM_TO_LINK[node.name];
    if (node.meshes) for (const mi of node.meshes) if (meshLink[mi] === undefined) { meshLink[mi] = link; meshPath[mi] = p.join('/'); }
    if (node.children) for (const c of node.children) walk(c, link, p);
  })(res.root, null, []);

  const out = res.meshes.map((m, mi) => {
    const p = m.attributes.position.array;
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    let cx = 0, cy = 0, cz = 0; const n = p.length / 3;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], p[i + k]); bb[k + 3] = Math.max(bb[k + 3], p[i + k]); }
      cx += p[i]; cy += p[i + 1]; cz += p[i + 2];
    }
    return {
      i: mi, name: m.name || '', link: meshLink[mi] || null, path: meshPath[mi] || '',
      skip: !!(m.name && SKIP_RE.test(m.name)),
      c: [cx / n, cy / n, cz / n].map(v => +v.toFixed(1)),
      bb: bb.map(v => +v.toFixed(1)),
      tris: (m.index ? m.index.array.length : p.length / 3) / 3,
    };
  });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.error(`wrote ${out.length} solids -> ${OUT}`);
})();
