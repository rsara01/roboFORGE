const { NodeIO } = require('@gltf-transform/core');
(async()=>{
  const io=new NodeIO(); const doc=await io.read('../../assets/rs/rs_j6.glb');
  const ZCUT=parseFloat(process.argv[2]||'0.055');
  const bb=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  let n=0;
  for(const mesh of doc.getRoot().listMeshes())
    for(const pr of mesh.listPrimitives()){
      const pos=pr.getAttribute('POSITION');
      const name=pr.getMaterial()?pr.getMaterial().getName():'?';
      for(let i=0;i<pos.getCount();i++){
        const v=[0,0,0]; pos.getElement(i,v);
        if(Math.abs(v[2])<ZCUT) continue;
        n++;
        for(let k=0;k<3;k++){bb[k]=Math.min(bb[k],v[k]);bb[k+3]=Math.max(bb[k+3],v[k]);}
      }
    }
  console.log('verts beyond |z|>'+ZCUT+':',n);
  console.log('bbox x['+bb[0].toFixed(4)+','+bb[3].toFixed(4)+'] y['+bb[1].toFixed(4)+','+bb[4].toFixed(4)+'] z['+bb[2].toFixed(4)+','+bb[5].toFixed(4)+']');
  console.log('cross-section: X='+(bb[3]-bb[0]).toFixed(4)+'  Y='+(bb[4]-bb[1]).toFixed(4));
  // which materials protrude
  const mats=new Set();
  for(const mesh of doc.getRoot().listMeshes())
    for(const pr of mesh.listPrimitives()){
      const pos=pr.getAttribute('POSITION');
      for(let i=0;i<pos.getCount();i++){const v=[0,0,0];pos.getElement(i,v);
        if(Math.abs(v[2])>=ZCUT){mats.add(pr.getMaterial()?pr.getMaterial().getName():'?');break;}}
    }
  console.log('protruding materials:',[...mats].join(', '));
})();
