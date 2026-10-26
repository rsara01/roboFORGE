// Print the STEP assembly node tree (names, mesh counts, bbox per node).
const fs = require('fs');
const occtimportjs = require('occt-import-js');
(async () => {
  const occt = await occtimportjs();
  const res = occt.ReadStepFile(new Uint8Array(fs.readFileSync(process.argv[2])), {
    linearUnit: 'millimeter', linearDeflectionType: 'absolute_value',
    linearDeflection: 6.0, angularDeflection: 1.2,
  });
  const bbOf = mi => {
    const p = res.meshes[mi].attributes.position.array;
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
      bb[k] = Math.min(bb[k], p[i + k]); bb[k + 3] = Math.max(bb[k + 3], p[i + k]);
    }
    return bb;
  };
  const merge = (a, b) => { for (let k = 0; k < 3; k++) { a[k] = Math.min(a[k], b[k]); a[k + 3] = Math.max(a[k + 3], b[k + 3]); } return a; };
  (function walk(node, d) {
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    let n = 0;
    (function acc(x) {
      if (x.meshes) for (const mi of x.meshes) { merge(bb, bbOf(mi)); n++; }
      if (x.children) x.children.forEach(acc);
    })(node);
    if (d <= 2) console.log(`${'  '.repeat(d)}${node.name || '(root)'}  solids=${n} bb=[${bb.map(v => v.toFixed(0)).join(',')}]`);
    if (node.children) for (const c of node.children) walk(c, d + 1);
  })(res.root, 0);
})();
