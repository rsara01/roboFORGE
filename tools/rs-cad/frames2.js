// Extract each joint's TRUE axis by proximity to its known pivot: collect all
// geometry within R mm of the pivot, PCA; the disc normal (smallest spread) is
// the joint axis. Print candidate axes + disc-ness so we can sanity check.
const fs = require('fs');
const occtimportjs = require('occt-import-js');
const STEP = process.argv[2];
const R = parseFloat(process.argv[3] || '40');

const JOINT_ORIGIN = {
  j1: [0, 75, 0], j2: [-20, 145, -8], j3: [216, 145, 0],
  j4: [-12, 217.7, 0], j5: [-99, 217.7, 0], j6: [-158, 217.7, 0],
};
const SKIP_RE = /^(7-HM|7-KA|7-KM|9-XT30|9-SOCKET|9-M-RS|6-BEARING|6-THRUST|2-CD|6-SILICONE)/i;

function eig3(C) {
  let a = C.map(r => r.slice()); let V = [[1,0,0],[0,1,0],[0,0,1]];
  for (let it=0; it<60; it++) {
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
const snap = v => { // nearest cardinal for readability
  const ax=['x','y','z']; let bi=0,bm=0; for(let i=0;i<3;i++)if(Math.abs(v[i])>bm){bm=Math.abs(v[i]);bi=i;}
  return (v[bi]<0?'-':'+')+ax[bi];
};

(async () => {
  const occt = await occtimportjs();
  const res = occt.ReadStepFile(new Uint8Array(fs.readFileSync(STEP)), {
    linearUnit:'millimeter', linearDeflectionType:'absolute_value', linearDeflection:1.5, angularDeflection:0.8,
  });
  for (const J of Object.keys(JOINT_ORIGIN)) {
    const O = JOINT_ORIGIN[J]; const pts=[];
    res.meshes.forEach(m=>{
      if(m.name && SKIP_RE.test(m.name)) return;
      const p=m.attributes.position.array;
      for(let i=0;i<p.length;i+=3){
        const d=Math.hypot(p[i]-O[0],p[i+1]-O[1],p[i+2]-O[2]);
        if(d<=R) pts.push([p[i],p[i+1],p[i+2]]);
      }
    });
    if(pts.length<50){ console.log(`${J}: only ${pts.length} pts near pivot`); continue; }
    const n=pts.length, c=[0,0,0];
    for(const p of pts){c[0]+=p[0];c[1]+=p[1];c[2]+=p[2];} c[0]/=n;c[1]/=n;c[2]/=n;
    const C=[[0,0,0],[0,0,0],[0,0,0]];
    for(const p of pts){const d=[p[0]-c[0],p[1]-c[1],p[2]-c[2]];for(let a=0;a<3;a++)for(let b=0;b<3;b++)C[a][b]+=d[a]*d[b];}
    for(let a=0;a<3;a++)for(let b=0;b<3;b++)C[a][b]/=n;
    const e=eig3(C);
    const axis=e[0].vec; const sp=e.map(x=>Math.sqrt(Math.max(0,x.val)));
    // disc-ness: axis clean if smallest spread << other two AND other two similar
    const discness=(sp[1]/(sp[0]+1e-6)).toFixed(1);
    console.log(`${J}: axis=[${axis.map(x=>x.toFixed(3))}] ~${snap(axis)}  spreads=[${sp.map(x=>x.toFixed(1))}] disc-ratio=${discness} pts=${n}`);
  }
})();
