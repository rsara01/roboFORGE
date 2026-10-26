// RS STEP -> per-link GLB + manifest.json  (offline converter)
// Usage: node convert.js <step> <outDir> [deflectionMM] [angular]
const fs = require('fs');
const path = require('path');
const occtimportjs = require('occt-import-js');

const STEP = process.argv[2];
const OUT  = process.argv[3];
const LDEF = parseFloat(process.argv[4] || '0.6');   // linear deflection, mm
const ADEF = parseFloat(process.argv[5] || '0.8');   // angular deflection, rad

// ---- CAD joint origins (mm, world, Y-up) extracted from STEP placements ----
const JOINT_ORIGIN = {
  base: [0, 0, 0],
  j1:   [0, 75, 0],
  j2:   [-20, 145, -8],
  j3:   [216, 145, 0],
  j4:   [-12, 217.7, 0],
  j5:   [-99, 217.7, 0],
  j6:   [-158, 217.7, 0],
};
// map top-level sub-assembly name -> link id
const ASM_TO_LINK = {
  '01-BASE_ASM': 'base',
  '02-RS-LINK-1_ASM': 'j1',
  '03-RS-LINK-2_ASM': 'j2',
  '04-RS-LINK-3_ASM': 'j3',
  '05-RS-LINK-4_ASM': 'j4',
  '06-RS-LINK-5_ASM': 'j5',
  '07-RS-GRIPPER_ASM': 'j6',
  '2-LINK-4_5-R': 'j4',
  '2-LINK-4_5-L': 'j4',
};
const CHAIN = ['base','j1','j2','j3','j4','j5','j6'];

// canonical zero-pose link axis per joint (unfold target). '+y' = straight up.
const LINK_AXIS = { j1:'+y', j2:'+y', j3:'+y', j4:'+y', j5:'+y', j6:'+y' };
const AXIS_VEC = { '+y':[0,1,0], '-y':[0,-1,0], '+x':[1,0,0], '-x':[-1,0,0], '+z':[0,0,1], '-z':[0,0,-1] };

// skip internal fasteners / electronics / bearings to cut clutter + tris
const SKIP_RE = /^(7-HM|7-KA|7-KM|9-XT30|9-SOCKET|9-M-RS|6-BEARING|6-THRUST|2-CD|6-SILICONE)/i;

// ---------- vec helpers ----------
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const len=v=>Math.hypot(v[0],v[1],v[2]);
const nrm=v=>{const l=len(v)||1;return [v[0]/l,v[1]/l,v[2]/l];};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
// quaternion (x,y,z,w) rotating unit a -> unit b
function quatFromTo(a,b){
  a=nrm(a); b=nrm(b);
  let d=dot(a,b);
  if(d<-0.999999){ // opposite
    let axis=cross([1,0,0],a); if(len(axis)<1e-6) axis=cross([0,1,0],a);
    axis=nrm(axis); return [axis[0],axis[1],axis[2],0];
  }
  const c=cross(a,b); const w=1+d;
  const q=[c[0],c[1],c[2],w]; const l=Math.hypot(q[0],q[1],q[2],q[3])||1;
  return [q[0]/l,q[1]/l,q[2]/l,q[3]/l];
}
function applyQuat(v,q){
  const [x,y,z]=v,[qx,qy,qz,qw]=q;
  const ix=qw*x+qy*z-qz*y, iy=qw*y+qz*x-qx*z, iz=qw*z+qx*y-qy*x, iw=-qx*x-qy*y-qz*z;
  return [ix*qw+iw*-qx+iy*-qz-iz*-qy, iy*qw+iw*-qy+iz*-qx-ix*-qz, iz*qw+iw*-qz+ix*-qy-iy*-qx];
}

(async () => {
  const occt = await occtimportjs();
  const buf = fs.readFileSync(STEP);
  console.error('reading STEP…');
  const t0=Date.now();
  const res = occt.ReadStepFile(new Uint8Array(buf), {
    linearUnit:'millimeter',
    linearDeflectionType:'absolute_value',
    linearDeflection: LDEF,
    angularDeflection: ADEF,
  });
  if(!res.success){console.error('read failed');process.exit(1);}
  console.error(`read ok ${(Date.now()-t0)/1000}s meshes=${res.meshes.length}`);

  // map meshIndex -> top-level link id via tree walk
  const meshLink = {};
  function walk(node, curLink){
    let link = curLink;
    if(node.name && ASM_TO_LINK[node.name] !== undefined) link = ASM_TO_LINK[node.name];
    if(node.meshes) for(const mi of node.meshes) if(meshLink[mi]===undefined) meshLink[mi]=link;
    if(node.children) for(const c of node.children) walk(c, link);
  }
  walk(res.root, null);

  // gather triangles per link, applying skip filter by mesh name
  const groups = {}; // link -> {pos:[], nrm:[], idx:[], off:0}
  for(const L of CHAIN) groups[L]={pos:[],nrm:[],idx:[]};
  let skipped=0, kept=0;
  res.meshes.forEach((m,mi)=>{
    const L = meshLink[mi];
    if(L===undefined || L===null) return;
    if(m.name && SKIP_RE.test(m.name)){skipped++; return;}
    kept++;
    const g=groups[L];
    const p=m.attributes.position.array;
    const n=m.attributes.normal?m.attributes.normal.array:null;
    const base=g.pos.length/3;
    for(let i=0;i<p.length;i++){ g.pos.push(p[i]); g.nrm.push(n?n[i]:0); }
    const idx=m.index?m.index.array:null;
    if(idx){ for(let i=0;i<idx.length;i++) g.idx.push(idx[i]+base); }
    else { for(let i=0;i<p.length/3;i++) g.idx.push(base+i); }
  });
  console.error(`kept ${kept} solids, skipped ${skipped} fastener/electronic solids`);

  fs.mkdirSync(OUT,{recursive:true});
  const manifest={ name:'RS', source:path.basename(STEP), units:'m', upAxis:'Y',
    note:'Baked to meters, Y-up. Each link mesh origin = its joint axis; canonical zero pose = straight +Y stack.',
    links:[] };

  let totalTris=0;
  for(let ci=0; ci<CHAIN.length; ci++){
    const L=CHAIN[ci];
    const g=groups[L];
    if(g.pos.length===0){ console.error(`WARN ${L} empty`); continue; }
    const O=JOINT_ORIGIN[L];
    // bake transform: translate -O, rotate unfold (worldDir -> linkAxis), scale mm->m
    let q=[0,0,0,1];
    let linkAxis=null, linkLength=null;
    if(L!=='base'){
      const nextL = CHAIN[ci+1];
      linkAxis = LINK_AXIS[L] || '+y';
      if(nextL){
        const worldDir = sub(JOINT_ORIGIN[nextL], O);
        linkLength = len(worldDir)/1000;
        q = quatFromTo(worldDir, AXIS_VEC[linkAxis]);
      } else {
        // last link (gripper): unfold along its longest extent from O
        linkAxis='+y'; q=[0,0,0,1];
      }
    }
    // apply bake to positions & normals
    const P=new Float32Array(g.pos.length), N=new Float32Array(g.nrm.length);
    const bb=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    let maxR=0;
    for(let i=0;i<g.pos.length;i+=3){
      let v=[g.pos[i]-O[0], g.pos[i+1]-O[1], g.pos[i+2]-O[2]];
      v=applyQuat(v,q);
      v=[v[0]/1000, v[1]/1000, v[2]/1000];
      P[i]=v[0];P[i+1]=v[1];P[i+2]=v[2];
      for(let k=0;k<3;k++){bb[k]=Math.min(bb[k],v[k]);bb[k+3]=Math.max(bb[k+3],v[k]);}
      // radial extent about +y axis (for collision radius)
      const r=Math.hypot(v[0],v[2]); if(r>maxR)maxR=r;
      let nn=[g.nrm[i],g.nrm[i+1],g.nrm[i+2]];
      nn=applyQuat(nn,q);
      N[i]=nn[0];N[i+1]=nn[1];N[i+2]=nn[2];
    }
    const I=new Uint32Array(g.idx);
    const tris=I.length/3; totalTris+=tris;
    const file=`rs_${L}.glb`;
    writeGLB(path.join(OUT,file), P, N, I, bb);
    const linkEntry={ id:L, file, tris,
      jointAxis: L==='base'?null:(L==='j1'?'y':(['j2','j3','j5'].includes(L)?'z':'x')),
      linkAxis: L==='base'?null:linkAxis,
      linkLength: linkLength!=null?round(linkLength,4):(L==='j6'?round((bb[4]-bb[1]),4):null),
      collisionRadius: round(Math.max(0.03, maxR*0.9),4),
      min: L==='base'?null:(L==='j1'?-3.14:(-2.3)),
      max: L==='base'?null:(L==='j1'? 3.14:( 2.3)),
      aabb: bb.map(v=>round(v,4)),
    };
    manifest.links.push(linkEntry);
    console.error(`${L}: tris=${tris} len=${linkEntry.linkLength} colR=${linkEntry.collisionRadius} aabb=[${bb.map(v=>v.toFixed(3)).join(',')}]`);
  }
  manifest.totalTris=totalTris;
  fs.writeFileSync(path.join(OUT,'manifest.json'), JSON.stringify(manifest,null,2));
  console.error(`TOTAL tris=${totalTris}  -> ${OUT}`);
})();

function round(v,d){const f=10**d;return Math.round(v*f)/f;}

// ---- minimal single-mesh GLB writer (POSITION, NORMAL, indices) ----
function writeGLB(file, P, N, I, bb){
  // pad helper
  function pad4(len){return (4-(len%4))%4;}
  const idxBytes=I.byteLength, posBytes=P.byteLength, nrmBytes=N.byteLength;
  const idxPad=pad4(idxBytes);
  const posOff=idxBytes+idxPad;
  const nrmOff=posOff+posBytes;
  const binLen=nrmOff+nrmBytes;
  const bin=Buffer.alloc(binLen);
  Buffer.from(I.buffer,I.byteOffset,idxBytes).copy(bin,0);
  Buffer.from(P.buffer,P.byteOffset,posBytes).copy(bin,posOff);
  Buffer.from(N.buffer,N.byteOffset,nrmBytes).copy(bin,nrmOff);

  const json={
    asset:{version:'2.0',generator:'rsconv'},
    scene:0, scenes:[{nodes:[0]}], nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:1,NORMAL:2},indices:0,mode:4}]}],
    buffers:[{byteLength:binLen}],
    bufferViews:[
      {buffer:0,byteOffset:0,byteLength:idxBytes,target:34963},
      {buffer:0,byteOffset:posOff,byteLength:posBytes,target:34962},
      {buffer:0,byteOffset:nrmOff,byteLength:nrmBytes,target:34962},
    ],
    accessors:[
      {bufferView:0,componentType:5125,count:I.length,type:'SCALAR'},
      {bufferView:1,componentType:5126,count:P.length/3,type:'VEC3',min:[bb[0],bb[1],bb[2]],max:[bb[3],bb[4],bb[5]]},
      {bufferView:2,componentType:5126,count:N.length/3,type:'VEC3'},
    ],
  };
  let jsonStr=JSON.stringify(json);
  const jsonPad=pad4(Buffer.byteLength(jsonStr));
  jsonStr+=' '.repeat(jsonPad);
  const jsonBuf=Buffer.from(jsonStr,'utf8');
  const total=12+8+jsonBuf.length+8+bin.length;
  const out=Buffer.alloc(total);
  let o=0;
  out.writeUInt32LE(0x46546C67,o);o+=4; // glTF
  out.writeUInt32LE(2,o);o+=4;
  out.writeUInt32LE(total,o);o+=4;
  out.writeUInt32LE(jsonBuf.length,o);o+=4;
  out.writeUInt32LE(0x4E4F534A,o);o+=4; // JSON
  jsonBuf.copy(out,o);o+=jsonBuf.length;
  out.writeUInt32LE(bin.length,o);o+=4;
  out.writeUInt32LE(0x004E4942,o);o+=4; // BIN
  bin.copy(out,o);
  fs.writeFileSync(file,out);
}
