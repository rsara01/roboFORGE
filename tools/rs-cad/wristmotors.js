// Robustly extract each wrist joint's motor axis. For each joint, gather the
// named motor solids (STATOR/ROTOR) that sit closest to that joint's pivot,
// PCA them, and report the disc-normal (smallest-spread) axis + the long axis.
const fs = require('fs');
const occt = require('occt-import-js');

const PIVOT = { j4: [-12, 217.7, 0], j5: [-99, 217.7, 0], j6: [-158, 217.7, 0] };

function eig3(C) {
  let a = C.map(r => r.slice()); let V = [[1,0,0],[0,1,0],[0,0,1]];
  for (let it=0; it<80; it++) {
    let p=0,q=1,max=Math.abs(a[0][1]);
    for (const [i,j] of [[0,1],[0,2],[1,2]]) if (Math.abs(a[i][j])>=max){max=Math.abs(a[i][j]);p=i;q=j;}
    if (max<1e-12) break;
    const phi=0.5*Math.atan2(2*a[p][q], a[q][q]-a[p][p]); const c=Math.cos(phi), s=Math.sin(phi);
    const A=a.map(r=>r.slice());
    for(let k=0;k<3;k++){A[p][k]=c*a[p][k]-s*a[q][k];A[q][k]=s*a[p][k]+c*a[q][k];}
    for(let k=0;k<3;k++){a[k][p]=A[p][k];a[k][q]=A[q][k];}
    a[p][p]=A[p][p];a[q][q]=A[q][q];a[p][q]=a[q][p]=0;
    const Vn=V.map(r=>r.slice());
    for(let k=0;k<3;k++){Vn[k][p]=c*V[k][p]-s*V[k][q];Vn[k][q]=s*V[k][p]+c*V[k][q];}
    V=Vn;
  }
  return [a[0][0],a[1][1],a[2][2]].map((v,i)=>({val:v,vec:[V[0][i],V[1][i],V[2][i]]})).sort((x,y)=>x.val-y.val);
}
const snap = v => { const ax=['x','y','z']; let bi=0; for(let i=1;i<3;i++)if(Math.abs(v[i])>Math.abs(v[bi]))bi=i; return (v[bi]<0?'-':'+')+ax[bi]; };

(async () => {
  const o = await occt();
  const res = o.ReadStepFile(new Uint8Array(fs.readFileSync(process.argv[2])), {
    linearUnit:'millimeter', linearDeflectionType:'absolute_value', linearDeflection:1.0, angularDeflection:0.6,
  });
  // collect motor solids: name matches STATOR/ROTOR/RORATOR/RSM/M6/M7, with centroid
  const motors = [];
  res.meshes.forEach(m => {
    if (!m.name || !/STATOR|ROTOR|RORATOR|RSM|-M6|-M7/i.test(m.name)) return;
    const p = m.attributes.position.array; let cx=0,cy=0,cz=0,n=p.length/3;
    for (let i=0;i<p.length;i+=3){cx+=p[i];cy+=p[i+1];cz+=p[i+2];}
    motors.push({ name:m.name, c:[cx/n,cy/n,cz/n], pts:p });
  });
  for (const J of Object.keys(PIVOT)) {
    const O = PIVOT[J];
    // motor solids whose centroid is within 60mm of this pivot
    const near = motors.filter(mo => Math.hypot(mo.c[0]-O[0],mo.c[1]-O[1],mo.c[2]-O[2]) < 60);
    if (!near.length) { console.log(`${J}: no motor within 60mm of pivot`); continue; }
    // PCA over all their points
    const all=[]; for (const mo of near) for (let i=0;i<mo.pts.length;i+=3) all.push([mo.pts[i],mo.pts[i+1],mo.pts[i+2]]);
    const n=all.length, c=[0,0,0]; for(const p of all){c[0]+=p[0];c[1]+=p[1];c[2]+=p[2];} c[0]/=n;c[1]/=n;c[2]/=n;
    const C=[[0,0,0],[0,0,0],[0,0,0]];
    for(const p of all){const d=[p[0]-c[0],p[1]-c[1],p[2]-c[2]];for(let a=0;a<3;a++)for(let b=0;b<3;b++)C[a][b]+=d[a]*d[b];}
    for(let a=0;a<3;a++)for(let b=0;b<3;b++)C[a][b]/=n;
    const e=eig3(C); const sp=e.map(x=>Math.sqrt(Math.max(0,x.val)));
    console.log(`${J}: pivot=[${O}]  motorCentroid=[${c.map(v=>v.toFixed(0))}]`);
    console.log(`   solids: ${near.map(m=>m.name).join(', ')}`);
    console.log(`   spreads=[${sp.map(v=>v.toFixed(1))}]  small-axis=${snap(e[0].vec)} [${e[0].vec.map(v=>v.toFixed(2))}]  large-axis=${snap(e[2].vec)} [${e[2].vec.map(v=>v.toFixed(2))}]`);
  }
})();
