/**
 * URDF → a plain JavaScript model of the robot, plus a list of problems.
 *
 * Covers the whole URDF spec (http://wiki.ros.org/urdf/XML): links with
 * inertial / visual / collision, every geometry type, named and inline
 * materials, all six joint types with origin, axis, limit, dynamics, mimic,
 * calibration and safety_controller. Each object keeps a reference to its XML
 * element (`el`) so anything we don't model (transmissions, <gazebo>, vendor
 * tags) is still there when the file is written back out.
 */

const JOINT_TYPES = new Set(['revolute', 'continuous', 'prismatic', 'fixed', 'floating', 'planar']);

const num = (s, d = 0) => { const v = parseFloat(s); return Number.isFinite(v) ? v : d; };
const vec = (s, d) => {
  if (s == null || !String(s).trim()) return d.slice();
  const v = String(s).trim().split(/\s+/).map(Number);
  return v.length === d.length && v.every(Number.isFinite) ? v : d.slice();
};
/** Direct children with a tag name (querySelector would also find grandchildren). */
const kids = (el, tag) => [...el.children].filter(c => c.localName === tag);
const kid = (el, tag) => kids(el, tag)[0] || null;

function parseOrigin(el) {
  const o = el && kid(el, 'origin');
  return {
    xyz: vec(o?.getAttribute('xyz'), [0, 0, 0]),
    rpy: vec(o?.getAttribute('rpy'), [0, 0, 0]),
  };
}

function parseMaterial(el) {
  if (!el) return null;
  const color = kid(el, 'color');
  const tex = kid(el, 'texture');
  return {
    name: el.getAttribute('name') || '',
    color: color ? vec(color.getAttribute('rgba'), [1, 1, 1, 1]) : null,
    texture: tex?.getAttribute('filename') || null,
    el,
  };
}

function parseGeometry(el, where, problems) {
  const g = el && kid(el, 'geometry');
  const shape = g && [...g.children][0];
  if (!shape) { problems.push({ level: 'error', msg: `${where} has no <geometry> shape.` }); return null; }
  switch (shape.localName) {
    case 'box':      return { type: 'box', size: vec(shape.getAttribute('size'), [1, 1, 1]) };
    case 'cylinder': return { type: 'cylinder', radius: num(shape.getAttribute('radius'), 0.1), length: num(shape.getAttribute('length'), 0.1) };
    case 'sphere':   return { type: 'sphere', radius: num(shape.getAttribute('radius'), 0.1) };
    case 'capsule':  return { type: 'capsule', radius: num(shape.getAttribute('radius'), 0.1), length: num(shape.getAttribute('length'), 0.1) };
    case 'mesh': {
      const filename = shape.getAttribute('filename') || '';
      if (!filename) problems.push({ level: 'error', msg: `${where} has a <mesh> with no filename.` });
      return { type: 'mesh', filename, scale: vec(shape.getAttribute('scale'), [1, 1, 1]) };
    }
    default:
      problems.push({ level: 'warn', msg: `${where} uses <${shape.localName}>, which isn't a URDF shape. Skipped.` });
      return null;
  }
}

function parseLink(el, problems) {
  const name = el.getAttribute('name') || '';
  const link = { name, inertial: null, visuals: [], collisions: [], el };

  const inr = kid(el, 'inertial');
  if (inr) {
    const I = kid(inr, 'inertia');
    const a = (k) => num(I?.getAttribute(k), 0);
    link.inertial = {
      origin: parseOrigin(inr),
      mass: num(kid(inr, 'mass')?.getAttribute('value'), 0),
      inertia: { ixx: a('ixx'), ixy: a('ixy'), ixz: a('ixz'), iyy: a('iyy'), iyz: a('iyz'), izz: a('izz') },
    };
    if (!(link.inertial.mass > 0)) problems.push({ level: 'warn', msg: `Link "${name}" has mass ${link.inertial.mass}. Physics engines want it above 0.` });
  }

  kids(el, 'visual').forEach((v, i) => {
    const geometry = parseGeometry(v, `Link "${name}" visual ${i + 1}`, problems);
    if (geometry) link.visuals.push({ name: v.getAttribute('name') || '', origin: parseOrigin(v), geometry, material: parseMaterial(kid(v, 'material')), el: v });
  });
  kids(el, 'collision').forEach((c, i) => {
    const geometry = parseGeometry(c, `Link "${name}" collision ${i + 1}`, problems);
    if (geometry) link.collisions.push({ name: c.getAttribute('name') || '', origin: parseOrigin(c), geometry, el: c });
  });
  return link;
}

function parseJoint(el, problems) {
  const name = el.getAttribute('name') || '';
  let type = el.getAttribute('type') || '';
  if (!JOINT_TYPES.has(type)) {
    problems.push({ level: 'error', msg: `Joint "${name}" has type "${type}". Treating it as fixed.` });
    type = 'fixed';
  }
  const lim = kid(el, 'limit');
  const dyn = kid(el, 'dynamics');
  const mim = kid(el, 'mimic');
  const cal = kid(el, 'calibration');
  const saf = kid(el, 'safety_controller');

  let axis = vec(kid(el, 'axis')?.getAttribute('xyz'), [1, 0, 0]);
  const len = Math.hypot(...axis);
  if (type !== 'fixed' && type !== 'floating') {
    if (len < 1e-9) { problems.push({ level: 'error', msg: `Joint "${name}" has a zero-length axis. Using 1 0 0.` }); axis = [1, 0, 0]; }
    else if (Math.abs(len - 1) > 1e-3) { problems.push({ level: 'info', msg: `Joint "${name}" axis isn't unit length, so I normalised it.` }); }
  }
  if (len > 1e-9) axis = axis.map(v => v / len);

  const joint = {
    name, type,
    parent: kid(el, 'parent')?.getAttribute('link') || '',
    child: kid(el, 'child')?.getAttribute('link') || '',
    origin: parseOrigin(el),
    axis,
    limit: lim ? {
      lower: num(lim.getAttribute('lower'), 0), upper: num(lim.getAttribute('upper'), 0),
      effort: num(lim.getAttribute('effort'), 0), velocity: num(lim.getAttribute('velocity'), 0),
    } : null,
    dynamics: dyn ? { damping: num(dyn.getAttribute('damping'), 0), friction: num(dyn.getAttribute('friction'), 0) } : null,
    mimic: mim ? { joint: mim.getAttribute('joint') || '', multiplier: num(mim.getAttribute('multiplier'), 1), offset: num(mim.getAttribute('offset'), 0) } : null,
    calibration: cal ? { rising: cal.getAttribute('rising'), falling: cal.getAttribute('falling') } : null,
    safety: saf ? {
      softLower: num(saf.getAttribute('soft_lower_limit'), 0), softUpper: num(saf.getAttribute('soft_upper_limit'), 0),
      kPosition: num(saf.getAttribute('k_position'), 0), kVelocity: num(saf.getAttribute('k_velocity'), 0),
    } : null,
    el,
  };

  if (!joint.parent) problems.push({ level: 'error', msg: `Joint "${name}" has no <parent link>.` });
  if (!joint.child) problems.push({ level: 'error', msg: `Joint "${name}" has no <child link>.` });
  if ((type === 'revolute' || type === 'prismatic') && !lim) {
    problems.push({ level: 'warn', msg: `Joint "${name}" is ${type} but has no <limit>. The spec requires one; using 0 to 0.` });
    joint.limit = { lower: 0, upper: 0, effort: 0, velocity: 0 };
  }
  if (joint.limit && joint.limit.lower > joint.limit.upper) {
    problems.push({ level: 'warn', msg: `Joint "${name}" has lower limit ${joint.limit.lower} above upper ${joint.limit.upper}.` });
  }
  return joint;
}

/**
 * Parse URDF text.
 * @returns {{ name: string, links: Map, joints: Map, materials: Map, root: string|null,
 *             childJoints: Map<string, object[]>, problems: {level:string,msg:string}[], doc: Document }}
 */
export function parseURDF(text) {
  const problems = [];
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const perr = doc.getElementsByTagName('parsererror')[0];
  if (perr) {
    const why = /error on line[^\n]*/i.exec(perr.textContent)?.[0] || perr.textContent.split('\n')[0];
    throw new Error('This file is not valid XML: ' + why.replace(/^error on/i, 'problem on'));
  }
  const robot = doc.documentElement;
  if (robot.localName !== 'robot') throw new Error(`Expected a <robot> element at the top, found <${robot.localName}>.`);
  // Generated URDFs often still declare xmlns:xacro, so look for actual xacro
  // elements or ${...} substitutions rather than the namespace.
  if ([...robot.getElementsByTagName('*')].some(e => e.prefix === 'xacro') || /="[^"]*\$\{/.test(text)) {
    throw new Error('This is a xacro file, not plain URDF. Run "xacro your_robot.urdf.xacro > robot.urdf" and load the output.');
  }

  const materials = new Map();
  for (const m of kids(robot, 'material')) {
    const mat = parseMaterial(m);
    if (mat.name) materials.set(mat.name, mat);
  }

  const links = new Map();
  for (const el of kids(robot, 'link')) {
    const l = parseLink(el, problems);
    if (!l.name) { problems.push({ level: 'error', msg: 'A <link> has no name. Skipped.' }); continue; }
    if (links.has(l.name)) problems.push({ level: 'error', msg: `Two links are called "${l.name}". Keeping the first.` });
    else links.set(l.name, l);
  }

  const joints = new Map();
  for (const el of kids(robot, 'joint')) {
    const j = parseJoint(el, problems);
    if (!j.name) { problems.push({ level: 'error', msg: 'A <joint> has no name. Skipped.' }); continue; }
    if (joints.has(j.name)) { problems.push({ level: 'error', msg: `Two joints are called "${j.name}". Keeping the first.` }); continue; }
    joints.set(j.name, j);
  }

  // Named materials used inside visuals pick up the robot-level definition.
  for (const l of links.values()) for (const v of l.visuals) {
    const m = v.material;
    if (m && !m.color && !m.texture && m.name) {
      const def = materials.get(m.name);
      if (def) { m.color = def.color; m.texture = def.texture; }
      else problems.push({ level: 'warn', msg: `Link "${l.name}" uses material "${m.name}", which is never defined.` });
    }
  }

  // Tree checks: every joint joins two real links, each link has one parent,
  // exactly one root, no loops.
  const parentOf = new Map();
  const childJoints = new Map([...links.keys()].map(n => [n, []]));
  for (const j of joints.values()) {
    const okP = links.has(j.parent), okC = links.has(j.child);
    if (j.parent && !okP) problems.push({ level: 'error', msg: `Joint "${j.name}" names parent link "${j.parent}", which doesn't exist.` });
    if (j.child && !okC) problems.push({ level: 'error', msg: `Joint "${j.name}" names child link "${j.child}", which doesn't exist.` });
    if (!okP || !okC) continue;
    if (parentOf.has(j.child)) { problems.push({ level: 'error', msg: `Link "${j.child}" has two parent joints ("${parentOf.get(j.child).name}" and "${j.name}"). URDF must be a tree.` }); continue; }
    parentOf.set(j.child, j);
    childJoints.get(j.parent).push(j);
  }
  const roots = [...links.keys()].filter(n => !parentOf.has(n));
  if (!links.size) problems.push({ level: 'error', msg: 'There are no links in this file.' });
  else if (!roots.length) problems.push({ level: 'error', msg: 'Every link has a parent, so the joints form a loop.' });
  else if (roots.length > 1) problems.push({ level: 'warn', msg: `${roots.length} links have no parent (${roots.slice(0, 4).join(', ')}${roots.length > 4 ? '…' : ''}). Using "${roots[0]}" as the base; the rest are shown at the origin.` });

  // Loop check: walk up from every link.
  for (const start of links.keys()) {
    const seen = new Set();
    let n = start;
    while (parentOf.has(n)) {
      if (seen.has(n)) { problems.push({ level: 'error', msg: `The joints around link "${start}" form a loop.` }); break; }
      seen.add(n); n = parentOf.get(n).parent;
    }
  }

  for (const j of joints.values()) {
    if (j.mimic && !joints.has(j.mimic.joint)) problems.push({ level: 'error', msg: `Joint "${j.name}" mimics "${j.mimic.joint}", which doesn't exist.` });
  }

  return { name: robot.getAttribute('name') || 'robot', links, joints, materials, root: roots[0] || null, roots, childJoints, parentOf, problems, doc };
}

/** Joints in tree order, base first (depth-first from each root). */
export function jointsInOrder(model) {
  const out = [];
  const walk = (link, depth) => {
    if (depth > 256) return;
    for (const j of model.childJoints.get(link) || []) { out.push(j); walk(j.child, depth + 1); }
  };
  for (const r of model.roots) walk(r, 0);
  return out;
}

/** Joints a user can move (not fixed, not mimic followers), base first. */
export function movableJoints(model) {
  return jointsInOrder(model).filter(j =>
    (j.type === 'revolute' || j.type === 'continuous' || j.type === 'prismatic') && !j.mimic);
}
