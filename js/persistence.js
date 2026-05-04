

export function robotToJSON(robot) {
  return {
    version: 2,
    colors: { ...robot.colors },
    joints: robot.joints.map(j => ({
      name: j.name,
      type: j.type,
      axis: j.axis,
      value: j.value,
      min: j.min,
      max: j.max,
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
  for (const j of data.joints) {
    const jt = robot.addJoint({
      type: j.type,
      axis: j.axis,
      linkLength: j.link?.length ?? 0.3,
      linkRadius: j.link?.radius ?? 0.05,
      linkColor: typeof j.link?.color === 'number' ? j.link.color : null,
      linkAxis: j.link?.axis ?? '+y',
      min: j.min,
      max: j.max,
    });
    if (jt && j.name) jt.name = j.name;
    if (jt && typeof j.value === 'number') {
      robot.setJointValue(robot.joints.length - 1, j.value);
    }
  }

  // v2 stores an array; v1 stored a single endEffector. Accept both.
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
    lines.push(`      <origin xyz="0 ${(j.link.length / 2).toFixed(4)} 0" rpy="0 0 0"/>`);
    lines.push(`      <geometry><cylinder length="${j.link.length.toFixed(4)}" radius="${j.link.radius.toFixed(4)}"/></geometry>`);
    lines.push(`    </visual>`);
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
  for (const lk of doc.getElementsByTagName('link')) {
    const name = lk.getAttribute('name');
    const cyl = lk.querySelector('visual > geometry > cylinder');
    if (cyl) {
      linkSize.set(name, {
        length: parseFloat(cyl.getAttribute('length') || '0.3'),
        radius: parseFloat(cyl.getAttribute('radius') || '0.05'),
      });
    }
  }

  robot.clear();
  for (const jn of joints) {
    const type = jn.getAttribute('type');
    const child = jn.querySelector('child')?.getAttribute('link');
    const axisAttr = jn.querySelector('axis')?.getAttribute('xyz') || '0 1 0';
    const lim = jn.querySelector('limit');
    const min = lim ? parseFloat(lim.getAttribute('lower') || '-3.14') : -Math.PI;
    const max = lim ? parseFloat(lim.getAttribute('upper') || '3.14') : Math.PI;
    const ax = parseAxis(axisAttr);
    const sz = linkSize.get(child) || { length: 0.3, radius: 0.05 };
    const j = robot.addJoint({
      type,
      axis: ax,
      linkLength: sz.length,
      linkRadius: sz.radius,
      min, max,
    });
    if (j) {
      j.name = jn.getAttribute('name') || j.name;
    }
  }

const eeJoints = Array.from(doc.getElementsByTagName('joint'))
    .filter(j => j.getAttribute('type') === 'fixed' && /end_effector_/.test(j.querySelector('child')?.getAttribute('link') || ''));
  if (makeEE) {
    for (const ee of eeJoints) {
      const childName = ee.querySelector('child').getAttribute('link');
      // Strip "end_effector_" prefix and any trailing "_<n>" suffix from duplicate-naming.
      const type = childName.replace(/^end_effector_/, '').replace(/_\d+$/, '');
      makeEE(type);
    }
  }
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
