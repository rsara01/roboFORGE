// Inspect RS STEP: assembly tree, per-top-level-node tri counts + world AABBs.
const fs = require('fs');
const occtimportjs = require('occt-import-js');

const STEP = process.argv[2];
const DEFLECT = parseFloat(process.argv[3] || '0.1'); // linear deflection in mm

(async () => {
  const occt = await occtimportjs();
  const buf = fs.readFileSync(STEP);
  const t0 = Date.now();
  const res = occt.ReadStepFile(new Uint8Array(buf), {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.001,
    angularDeflection: 0.5,
  });
  console.error('read ok=' + res.success + ' in ' + ((Date.now()-t0)/1000).toFixed(1) + 's; meshes=' + res.meshes.length);
  if (!res.success) process.exit(1);

  // meshes[i]: { name, color, attributes:{position:{array},normal:{array}}, index:{array} }
  function meshStats(mi) {
    const m = res.meshes[mi];
    const p = m.attributes.position.array;
    const idx = m.index ? m.index.array.length : (p.length/3);
    let tris = idx / 3;
    const bb = [Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    for (let i=0;i<p.length;i+=3){
      bb[0]=Math.min(bb[0],p[i]); bb[1]=Math.min(bb[1],p[i+1]); bb[2]=Math.min(bb[2],p[i+2]);
      bb[3]=Math.max(bb[3],p[i]); bb[4]=Math.max(bb[4],p[i+1]); bb[5]=Math.max(bb[5],p[i+2]);
    }
    return { tris, bb, verts: p.length/3 };
  }

  // aggregate a node subtree
  function collect(node, acc) {
    if (node.meshes) for (const mi of node.meshes) acc.push(mi);
    if (node.children) for (const c of node.children) collect(c, acc);
  }

  function agg(indices) {
    let tris=0, verts=0;
    const bb=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    for (const mi of indices){
      const s = meshStats(mi);
      tris+=s.tris; verts+=s.verts;
      for(let k=0;k<3;k++){bb[k]=Math.min(bb[k],s.bb[k]); bb[k+3]=Math.max(bb[k+3],s.bb[k+3]);}
    }
    return {tris,verts,bb};
  }

  function fmtbb(bb){return bb.map(v=>v.toFixed(1)).join(', ');}

  const root = res.root;
  console.log('ROOT: ' + root.name);
  const total = []; collect(root, total);
  const ta = agg(total);
  console.log('TOTAL tris=' + Math.round(ta.tris) + ' verts=' + ta.verts + ' worldAABB(mm)=[' + fmtbb(ta.bb) + ']');
  console.log('');
  console.log('TOP-LEVEL CHILDREN:');
  for (const c of (root.children||[])) {
    const idx=[]; collect(c, idx);
    const a = agg(idx);
    const size=[a.bb[3]-a.bb[0], a.bb[4]-a.bb[1], a.bb[5]-a.bb[2]];
    const ctr=[(a.bb[0]+a.bb[3])/2,(a.bb[1]+a.bb[4])/2,(a.bb[2]+a.bb[5])/2];
    console.log(`  ${c.name}`);
    console.log(`    tris=${Math.round(a.tris)} meshes=${idx.length}`);
    console.log(`    worldAABB(mm)=[${fmtbb(a.bb)}]`);
    console.log(`    size=[${size.map(v=>v.toFixed(1)).join(', ')}] center=[${ctr.map(v=>v.toFixed(1)).join(', ')}]`);
  }
})();
