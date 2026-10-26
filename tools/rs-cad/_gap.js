// Diagnose the assembled RS chain: where does each link's geometry actually sit
// relative to its own pivot, and does it reach its child's pivot?
const { NodeIO } = require('@gltf-transform/core');
const path = require('path');

const ROOT = '/Users/rishiksaravanan/robot-arm-sim';
const man = require(path.join(ROOT, 'assets/rs/manifest.json'));

function mulQ(a, b) { // quaternion multiply
  return [
    a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
    a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
    a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
    a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2],
  ];
}
function fromAxisAngle(ax, ang) {
  const l = Math.hypot(...ax) || 1;
  const s = Math.sin(ang/2)/l;
  return [ax[0]*s, ax[1]*s, ax[2]*s, Math.cos(ang/2)];
}
function applyQ(q, v) {
  const [x,y,z,w] = q; const [vx,vy,vz] = v;
  const ix = w*vx + y*vz - z*vy, iy = w*vy + z*vx - x*vz, iz = w*vz + x*vy - y*vx, iw = -x*vx - y*vy - z*vz;
  return [
    ix*w + iw*-x + iy*-z - iz*-y,
    iy*w + iw*-y + iz*-x - ix*-z,
    iz*w + iw*-z + ix*-y - iy*-x,
  ];
}
const add = (a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub = (a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const len = a=>Math.hypot(...a);

(async () => {
  const io = new NodeIO();
  const verts = {};
  for (const l of man.links) {
    const doc = await io.read(path.join(ROOT, 'assets/rs', l.file));
    const pts = [];
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const name = prim.getMaterial()?.getName() || '';
        const arr = pos.getArray();
        for (let i = 0; i < arr.length; i += 3) pts.push([arr[i], arr[i+1], arr[i+2], name]);
      }
    }
    verts[l.id] = pts;
    console.log(`${l.id}: ${pts.length} verts`);
  }

  const pose = process.argv[2] ? process.argv[2].split(',').map(Number) : [0,0,0,0,0,0];
  console.log('\npose =', pose.join(', '));

  // world transform per link
  let q = [0,0,0,1], p = [0,0,0];
  const frames = {};
  const pivots = {};
  for (let i = 0; i < man.links.length; i++) {
    const l = man.links[i];
    p = add(p, applyQ(q, l.parentOffset));
    pivots[l.id] = p.slice();
    if (l.axis) q = mulQ(q, fromAxisAngle(l.axis, pose[i-1] ?? 0));
    frames[l.id] = { q: q.slice(), p: p.slice() };
  }

  const world = {};
  for (const l of man.links) {
    const f = frames[l.id];
    world[l.id] = verts[l.id].map(v => add(f.p, applyQ(f.q, v)));
  }

  // For each link: distance from its own pivot to nearest vertex, and from the
  // child's pivot to nearest vertex of this link and of the child link.
  for (let i = 0; i < man.links.length; i++) {
    const l = man.links[i];
    const child = man.links[i+1];
    const near = (pt, id) => Math.min(...world[id].map(v => len(sub(v, pt))));
    let s = `${l.id}: ownPivot->nearestVert ${near(pivots[l.id], l.id).toFixed(4)}`;
    if (child) {
      s += `  | childPivot->this ${near(pivots[child.id], l.id).toFixed(4)}` +
           `  childPivot->child ${near(pivots[child.id], child.id).toFixed(4)}`;
      // min distance between the two link point clouds (subsampled)
      const A = world[l.id].filter((_, k) => k % 7 === 0);
      const B = world[child.id].filter((_, k) => k % 7 === 0);
      let m = Infinity;
      for (const a of A) for (const b of B) { const d = len(sub(a,b)); if (d < m) m = d; }
      s += `  minGap(sub) ${m.toFixed(4)}`;
    }
    console.log(s);
  }
})();
