

import { MeshLibrary } from './meshLibrary.js';

export function robotToJSON(robot) {
  const model = robot.meshSet && robot.meshSet !== 'procedural' ? robot.meshSet : 'procedural';
  return {
    version: 3,
    model,
    colors: { ...robot.colors },
    joints: robot.joints.map(j => ({
      name: j.name,
      type: j.type,
      axis: j.axis,
      value: j.value,
      min: j.min,
      max: j.max,
      mesh: j.meshId ?? null,   // CAD link id in the active mesh set (v3)
      link: {
        length: j.link.length,
        radius: j.link.radius,
        color: j.link.color ?? null,
        axis: j.link.axis ?? '+y',
      },
    })),
    endEffectors: robot.endEffectors.map(ee => ({
      type: ee.type,
      params: { ...ee.params },
    })),
  };
}

export function jsonToRobot(robot, data, makeEE) {
  robot.clear();
  if (!data || !Array.isArray(data.joints)) return;
  if (data.colors && typeof data.colors === 'object') {
    for (const [k, v] of Object.entries(data.colors)) {
      if (typeof v === 'number') robot.setColor(k, v);
    }
  }
  const model = data.model && data.model !== 'procedural' ? data.model : null;
  data.joints.forEach((j, i) => {
    // v3 carries an explicit per-joint mesh id; for a CAD model file that
    // predates that field, fall back to positional ids (j1..jN).
    const meshId = j.mesh ?? (model ? `j${i + 1}` : null);
    // For a faithful CAD arm the real joint frame (axis + tipOffset) lives in the
    // manifest, keyed by mesh id — pull it so a saved RS file reloads assembled.
    const entry = model && meshId ? MeshLibrary.getLinkEntry(model, meshId) : null;
    const jt = robot.addJoint({
      type: j.type,
      axis: j.axis,
      axisVec: Array.isArray(entry?.axis) ? entry.axis : null,
      tipOffset: Array.isArray(entry?.tipOffset) ? entry.tipOffset : null,
      linkLength: j.link?.length ?? 0.3,
      linkRadius: entry?.collisionRadius ?? j.link?.radius ?? 0.05,
      linkColor: typeof j.link?.color === 'number' ? j.link.color : null,
      linkAxis: j.link?.axis ?? '+y',
      min: j.min,
      max: j.max,
      meshId,
    });
    if (jt && j.name) jt.name = j.name;
    if (jt && typeof j.value === 'number') {
      robot.setJointValue(robot.joints.length - 1, j.value);
    }
  });

  const eeList = Array.isArray(data.endEffectors)
    ? data.endEffectors
    : (data.endEffector ? [data.endEffector] : []);
  if (makeEE) {
    for (const spec of eeList) {
      const ee = makeEE(spec.type);
      if (ee && spec.params) {
        for (const [k, v] of Object.entries(spec.params)) ee.setParam(k, v);
      }
    }
  }
}

const AXIS_VEC = { x: '1 0 0', y: '0 1 0', z: '0 0 1' };

export function robotToURDF(robot, name = 'roboforge_arm') {
  const model = robot.meshSet && robot.meshSet !== 'procedural' ? robot.meshSet : null;
  const pkg = model ? model.toLowerCase() : null;
  const lines = [];
  lines.push(`<?xml version="1.0"?>`);
  lines.push(`<robot name="${name}">`);
  lines.push(`  <link name="base_link"/>`);

  let prevLink = 'base_link';
  robot.joints.forEach((j, i) => {
    const jointName = j.name || `joint${i + 1}`;
    const linkName = `link${i + 1}`;
    const lim = `lower="${j.min.toFixed(4)}" upper="${j.max.toFixed(4)}" effort="100" velocity="2.0"`;
    lines.push(`  <joint name="${jointName}" type="${j.type === 'revolute' ? 'revolute' : 'prismatic'}">`);
    lines.push(`    <parent link="${prevLink}"/>`);
    lines.push(`    <child link="${linkName}"/>`);

lines.push(`    <origin xyz="0 0 0" rpy="0 0 0"/>`);
    lines.push(`    <axis xyz="${AXIS_VEC[j.axis] || '0 1 0'}"/>`);
    lines.push(`    <limit ${lim}/>`);
    lines.push(`  </joint>`);
    lines.push(`  <link name="${linkName}">`);
    lines.push(`    <visual>`);
    if (model && j.meshId) {
      // CAD visual references the baked per-link mesh; collision stays a cheap
      // cylinder primitive so downstream planners keep a capsule-like proxy.
      lines.push(`      <origin xyz="0 0 0" rpy="0 0 0"/>`);
      lines.push(`      <geometry><mesh filename="package://${pkg}/rs_${j.meshId}.glb"/></geometry>`);
    } else {
      lines.push(`      <origin xyz="0 ${(j.link.length / 2).toFixed(4)} 0" rpy="0 0 0"/>`);
      lines.push(`      <geometry><cylinder length="${j.link.length.toFixed(4)}" radius="${j.link.radius.toFixed(4)}"/></geometry>`);
    }
    lines.push(`    </visual>`);
    lines.push(`    <collision>`);
    lines.push(`      <origin xyz="0 ${(j.link.length / 2).toFixed(4)} 0" rpy="0 0 0"/>`);
    lines.push(`      <geometry><cylinder length="${j.link.length.toFixed(4)}" radius="${j.link.radius.toFixed(4)}"/></geometry>`);
    lines.push(`    </collision>`);
    lines.push(`  </link>`);
    prevLink = linkName;
  });

  robot.endEffectors.forEach((ee, idx) => {
    const linkName = `end_effector_${ee.type}${idx > 0 ? `_${idx}` : ''}`;
    lines.push(`  <link name="${linkName}"/>`);
    lines.push(`  <joint name="ee_mount${idx > 0 ? `_${idx}` : ''}" type="fixed">`);
    lines.push(`    <parent link="${prevLink}"/>`);
    lines.push(`    <child link="${linkName}"/>`);
    lines.push(`    <origin xyz="0 0 0" rpy="0 0 0"/>`);
    lines.push(`  </joint>`);
  });
  lines.push(`</robot>`);
  return lines.join('\n');
}

export function urdfToRobot(robot, urdfText, makeEE) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(urdfText, 'application/xml');
  const errs = doc.getElementsByTagName('parsererror');
  if (errs.length) throw new Error('URDF parse error: ' + errs[0].textContent);

  const joints = Array.from(doc.getElementsByTagName('joint')).filter(j => {
    const t = j.getAttribute('type');
    return t === 'revolute' || t === 'prismatic';
  });

const linkSize = new Map();
  const linkMesh = new Map();
  for (const lk of doc.getElementsByTagName('link')) {
    const name = lk.getAttribute('name');
    const cyl = lk.querySelector('visual > geometry > cylinder')
             || lk.querySelector('collision > geometry > cylinder');
    if (cyl) {
      linkSize.set(name, {
        length: parseFloat(cyl.getAttribute('length') || '0.3'),
        radius: parseFloat(cyl.getAttribute('radius') || '0.05'),
      });
    }
    const mesh = lk.querySelector('visual > geometry > mesh');
    if (mesh) {
      const m = /rs_([a-z0-9]+)\.glb/i.exec(mesh.getAttribute('filename') || '');
      if (m) linkMesh.set(name, m[1]);
    }
  }

  robot.clear();
  // CAD model referenced by the mesh visuals (RS is the only baked set today).
  const cadModel = linkMesh.size && MeshLibrary.isLoaded('RS') ? 'RS' : null;
  joints.forEach((jn, i) => {
    const type = jn.getAttribute('type');
    const child = jn.querySelector('child')?.getAttribute('link');
    const axisAttr = jn.querySelector('axis')?.getAttribute('xyz') || '0 1 0';
    const lim = jn.querySelector('limit');
    const min = lim ? parseFloat(lim.getAttribute('lower') || '-3.14') : -Math.PI;
    const max = lim ? parseFloat(lim.getAttribute('upper') || '3.14') : Math.PI;
    const ax = parseAxis(axisAttr);
    const sz = linkSize.get(child) || { length: 0.3, radius: 0.05 };
    const meshId = linkMesh.get(child) ?? null;
    // Restore the faithful joint frame from the manifest for CAD arms.
    const entry = cadModel && meshId ? MeshLibrary.getLinkEntry(cadModel, meshId) : null;
    const j = robot.addJoint({
      type,
      axis: ax,
      axisVec: Array.isArray(entry?.axis) ? entry.axis : null,
      tipOffset: Array.isArray(entry?.tipOffset) ? entry.tipOffset : null,
      linkLength: sz.length,
      linkRadius: entry?.collisionRadius ?? sz.radius,
      min, max,
      meshId,
    });
    if (j) {
      j.name = jn.getAttribute('name') || j.name;
    }
  });

const eeJoints = Array.from(doc.getElementsByTagName('joint'))
    .filter(j => j.getAttribute('type') === 'fixed' && /end_effector_/.test(j.querySelector('child')?.getAttribute('link') || ''));
  if (makeEE) {
    for (const ee of eeJoints) {
      const childName = ee.querySelector('child').getAttribute('link');

      const type = childName.replace(/^end_effector_/, '').replace(/_\d+$/, '');
      makeEE(type);
    }
  }
}

/** Detect a CAD model id (e.g. 'RS') referenced by a URDF's mesh visuals. */
export function urdfModel(urdfText) {
  const m = /package:\/\/([a-z0-9_]+)\/rs_[a-z0-9]+\.glb/i.exec(urdfText || '');
  return m ? m[1].toUpperCase() : null;
}

function parseAxis(str) {
  const [x, y, z] = str.trim().split(/\s+/).map(parseFloat);
  if (Math.abs(x) >= Math.abs(y) && Math.abs(x) >= Math.abs(z)) return 'x';
  if (Math.abs(y) >= Math.abs(z)) return 'y';
  return 'z';
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsText(file);
  });
}
