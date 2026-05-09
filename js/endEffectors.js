import * as THREE from 'three';

export const EE_TYPES = [
  'none', 'gripper', 'gripper3', 'suction', 'welder',
  'camera', 'drill', 'magnet', 'laser', 'paint',
];

export const EE_LABELS = {
  none:    'None',
  gripper: 'Parallel-jaw gripper',
  gripper3:'3-finger gripper',
  suction: 'Suction cup',
  welder:  'Welding torch',
  camera:  'Camera / sensor',
  drill:   'Drill / spindle',
  magnet:  'Electromagnet',
  laser:   'Laser cutter',
  paint:   'Paint sprayer',
};

export function createEndEffector(type) {
  switch (type) {
    case 'gripper':  return makeGripper();
    case 'gripper3': return makeGripper3();
    case 'suction':  return makeSuction();
    case 'welder':   return makeWelder();
    case 'camera':   return makeCamera();
    case 'drill':    return makeDrill();
    case 'magnet':   return makeMagnet();
    case 'laser':    return makeLaser();
    case 'paint':    return makePaint();
    default: return null;
  }
}

function makeGripper() {
  const group = new THREE.Group();
  group.name = 'ee-gripper';

  const baseMat = new THREE.MeshStandardMaterial({ color: 0xb0b8c1, roughness: 0.4, metalness: 0.6 });
  const fingerMat = new THREE.MeshStandardMaterial({ color: 0xd0d6dd, roughness: 0.3, metalness: 0.7 });

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.10), baseMat);
  palm.position.y = 0.03;
  palm.castShadow = palm.receiveShadow = true;
  group.add(palm);

  const fingerGeo = new THREE.BoxGeometry(0.018, 0.10, 0.05);
  const fLeft = new THREE.Mesh(fingerGeo, fingerMat);
  const fRight = new THREE.Mesh(fingerGeo, fingerMat);
  fLeft.castShadow = fRight.castShadow = true;
  fLeft.position.set(-0.045, 0.11, 0);
  fRight.position.set(0.045, 0.11, 0);
  group.add(fLeft, fRight);

  const tip = new THREE.Object3D();
  tip.position.y = 0.18;
  group.add(tip);

  const params = { open: 1 };

  function setOpen(v) {
    params.open = THREE.MathUtils.clamp(v, 0, 1);
    const half = 0.02 + params.open * 0.04;
    fLeft.position.x = -half;
    fRight.position.x = half;
  }
  setOpen(1);

  return {
    type: 'gripper',
    group, tip,
    pickables: [palm, fLeft, fRight],
    params,
    setParam(name, val) {
      if (name === 'open') setOpen(+val);
    },
    update() {  },
    dispose() {
      [palm, fLeft, fRight].forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    },
  };
}

function makeGripper3() {
  const group = new THREE.Group();
  group.name = 'ee-gripper3';

  const baseMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.6 });
  const fingerMat = new THREE.MeshStandardMaterial({ color: 0xd0d6dd, roughness: 0.3, metalness: 0.7 });

  const palm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.06, 24), baseMat);
  palm.position.y = 0.03;
  palm.castShadow = palm.receiveShadow = true;
  group.add(palm);

  const fingerGeo = new THREE.BoxGeometry(0.02, 0.10, 0.025);
  const fingers = [];
  const radii = 0.04;
  for (let k = 0; k < 3; k++) {
    const f = new THREE.Mesh(fingerGeo, fingerMat);
    f.castShadow = true;
    const ang = (k / 3) * Math.PI * 2;
    f.userData.baseAngle = ang;
    f.position.set(Math.cos(ang) * radii, 0.11, Math.sin(ang) * radii);
    f.rotation.y = -ang;
    group.add(f);
    fingers.push(f);
  }

  const tip = new THREE.Object3D();
  tip.position.y = 0.18;
  group.add(tip);

  const params = { open: 1 };

  function setOpen(v) {
    params.open = THREE.MathUtils.clamp(v, 0, 1);
    const r = 0.025 + params.open * 0.035;
    for (const f of fingers) {
      const a = f.userData.baseAngle;
      f.position.x = Math.cos(a) * r;
      f.position.z = Math.sin(a) * r;
    }
  }
  setOpen(1);

  return {
    type: 'gripper3',
    group, tip,
    pickables: [palm, ...fingers],
    params,
    setParam(name, val) {
      if (name === 'open') setOpen(+val);
    },
    update() {},
    dispose() {
      [palm, ...fingers].forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    },
  };
}

function makeSuction() {
  const group = new THREE.Group();
  group.name = 'ee-suction';

  const stemMat = new THREE.MeshStandardMaterial({ color: 0x808890, roughness: 0.4, metalness: 0.5 });
  const cupMat  = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7, metalness: 0.1 });

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 16), stemMat);
  stem.position.y = 0.04;
  stem.castShadow = stem.receiveShadow = true;
  group.add(stem);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.04, 24), cupMat);
  cup.position.y = 0.10;
  cup.castShadow = cup.receiveShadow = true;
  group.add(cup);

  const tip = new THREE.Object3D();
  tip.position.y = 0.13;
  group.add(tip);

  const params = { suction: 0 };

  const ringMat = new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.005, 8, 24), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.12;
  group.add(ring);

  return {
    type: 'suction',
    group, tip,
    pickables: [stem, cup],
    params,
    setParam(name, val) {
      if (name === 'suction') {
        params.suction = +val ? 1 : 0;
        ringMat.opacity = params.suction ? 0.8 : 0;
      }
    },
    update() {},
    dispose() {
      [stem, cup, ring].forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    },
  };
}

function makeWelder() {
  const group = new THREE.Group();
  group.name = 'ee-welder';

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5, metalness: 0.6 });
  const tipMat  = new THREE.MeshStandardMaterial({ color: 0xff9966, emissive: 0x441100, roughness: 0.3 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.10, 16), bodyMat);
  body.position.y = 0.05;
  body.castShadow = true;
  group.add(body);

  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 12), tipMat);
  nozzle.position.y = 0.13;
  nozzle.castShadow = true;
  group.add(nozzle);

  const tip = new THREE.Object3D();
  tip.position.y = 0.16;
  group.add(tip);

  const arc = new THREE.PointLight(0xfff0aa, 0, 0.6, 2);
  arc.position.y = 0.16;
  group.add(arc);

  const sparkMat = new THREE.SpriteMaterial({
    color: 0xffe4a3, transparent: true, opacity: 0,
  });
  const spark = new THREE.Sprite(sparkMat);
  spark.scale.set(0.06, 0.06, 0.06);
  spark.position.y = 0.16;
  group.add(spark);

  const params = { welding: 0 };
  let t = 0;

  return {
    type: 'welder',
    group, tip,
    pickables: [body, nozzle],
    params,
    setParam(name, val) {
      if (name === 'welding') {
        params.welding = +val ? 1 : 0;
      }
    },
    update(dt = 0.016) {
      t += dt;
      if (params.welding) {
        const flicker = 0.5 + 0.5 * Math.sin(t * 60) + 0.3 * Math.random();
        arc.intensity = 1.5 * flicker;
        sparkMat.opacity = 0.3 + 0.5 * Math.random();
        spark.scale.setScalar(0.05 + 0.04 * Math.random());
      } else {
        arc.intensity = 0;
        sparkMat.opacity = 0;
      }
    },
    dispose() {
      [body, nozzle, spark].forEach(m => { m.geometry?.dispose?.(); m.material?.dispose?.(); });
    },
  };
}

function makeCamera() {
  const group = new THREE.Group();
  group.name = 'ee-camera';

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x202428, roughness: 0.5, metalness: 0.4 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.9 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x4ea1ff, emissive: 0x113355, roughness: 0.3 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 0.07), bodyMat);
  body.position.y = 0.05;
  body.castShadow = true;
  group.add(body);

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 24), lensMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0.05, 0.045);
  group.add(lens);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.004, 8, 24), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 0.05, 0.06);
  group.add(ring);

  const frust = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.25, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x4ea1ff, transparent: true, opacity: 0.10, side: THREE.DoubleSide, wireframe: false })
  );
  frust.rotation.x = Math.PI / 2;
  frust.position.set(0, 0.05, 0.18);
  frust.visible = false;
  group.add(frust);

  const tip = new THREE.Object3D();
  tip.position.set(0, 0.05, 0.07);
  group.add(tip);

  const params = { showFrustum: 0 };
  return {
    type: 'camera',
    group, tip,
    pickables: [body, lens, ring],
    params,
    setParam(name, val) {
      if (name === 'showFrustum') {
        params.showFrustum = +val ? 1 : 0;
        frust.visible = !!params.showFrustum;
      }
    },
    update() {},
    dispose() {
      [body, lens, ring, frust].forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    },
  };
}

function makeDrill() {
  const group = new THREE.Group();
  group.name = 'ee-drill';

  const housingMat = new THREE.MeshStandardMaterial({ color: 0xd47322, roughness: 0.45, metalness: 0.4 });
  const collarMat  = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.7 });
  const bitMat     = new THREE.MeshStandardMaterial({ color: 0xa8b0ba, roughness: 0.25, metalness: 0.9 });

  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.10, 20), housingMat);
  housing.position.y = 0.05;
  housing.castShadow = housing.receiveShadow = true;
  group.add(housing);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.025, 18), collarMat);
  collar.position.y = 0.1125;
  group.add(collar);

  const spinner = new THREE.Group();
  spinner.position.y = 0.13;
  group.add(spinner);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 12), bitMat);
  shaft.position.y = 0.03;
  shaft.castShadow = true;
  spinner.add(shaft);

  const flute = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 12), bitMat);
  flute.position.y = 0.08;
  flute.castShadow = true;
  spinner.add(flute);

  const tip = new THREE.Object3D();
  tip.position.y = 0.20;
  group.add(tip);

  const params = { spinning: 0, rpm: 1200 };

  return {
    type: 'drill',
    group, tip,
    pickables: [housing, collar, shaft, flute],
    params,
    setParam(name, val) {
      if (name === 'spinning') params.spinning = +val ? 1 : 0;
      else if (name === 'rpm') params.rpm = Math.max(0, +val);
    },
    update(dt = 0.016) {
      if (params.spinning) {
        const omega = (params.rpm / 60) * Math.PI * 2;
        spinner.rotation.y += omega * dt;
      }
    },
    dispose() {
      [housing, collar, shaft, flute].forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    },
  };
}

function makeMagnet() {
  const group = new THREE.Group();
  group.name = 'ee-magnet';

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b7480, roughness: 0.5, metalness: 0.7 });
  const poleNMat = new THREE.MeshStandardMaterial({ color: 0xc94a4a, roughness: 0.45, metalness: 0.4 });
  const poleSMat = new THREE.MeshStandardMaterial({ color: 0x3a6cd1, roughness: 0.45, metalness: 0.4 });
  const fieldMat = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.0 });

  const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.04, 0.05), bodyMat);
  yoke.position.y = 0.02;
  yoke.castShadow = yoke.receiveShadow = true;
  group.add(yoke);

  const poleN = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.07, 0.05), poleNMat);
  poleN.position.set(-0.0375, 0.075, 0);
  poleN.castShadow = true;
  group.add(poleN);

  const poleS = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.07, 0.05), poleSMat);
  poleS.position.set(0.0375, 0.075, 0);
  poleS.castShadow = true;
  group.add(poleS);

  const field = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), fieldMat);
  field.position.y = 0.10;
  group.add(field);

  const tip = new THREE.Object3D();
  tip.position.y = 0.12;
  group.add(tip);

  const params = { energized: 0 };
  let t = 0;

  return {
    type: 'magnet',
    group, tip,
    pickables: [yoke, poleN, poleS],
    params,
    setParam(name, val) {
      if (name === 'energized') params.energized = +val ? 1 : 0;
    },
    update(dt = 0.016) {
      t += dt;
      if (params.energized) {
        fieldMat.opacity = 0.18 + 0.08 * Math.sin(t * 6);
      } else {
        fieldMat.opacity = 0;
      }
    },
    dispose() {
      [yoke, poleN, poleS, field].forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    },
  };
}

function makeLaser() {
  const group = new THREE.Group();
  group.name = 'ee-laser';

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.4, metalness: 0.7 });
  const apMat   = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.9 });
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xff2030, transparent: true, opacity: 0.0 });
  const dotMat  = new THREE.MeshBasicMaterial({ color: 0xff5566, transparent: true, opacity: 0.0 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.10, 18), bodyMat);
  body.position.y = 0.05;
  body.castShadow = true;
  group.add(body);

  const aperture = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 16), apMat);
  aperture.position.y = 0.106;
  group.add(aperture);

  const beamLen = 0.6;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0025, 0.0025, beamLen, 8, 1, true),
    beamMat
  );
  beam.position.y = 0.11 + beamLen / 2;
  group.add(beam);

  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), dotMat);
  dot.position.y = 0.11 + beamLen;
  group.add(dot);

  const tip = new THREE.Object3D();
  tip.position.y = 0.11;
  group.add(tip);

  const params = { firing: 0 };
  let t = 0;

  return {
    type: 'laser',
    group, tip,
    pickables: [body, aperture],
    params,
    setParam(name, val) {
      if (name === 'firing') params.firing = +val ? 1 : 0;
    },
    update(dt = 0.016) {
      t += dt;
      if (params.firing) {
        const flicker = 0.65 + 0.2 * Math.sin(t * 50);
        beamMat.opacity = flicker;
        dotMat.opacity = 0.85 + 0.1 * Math.sin(t * 80);
      } else {
        beamMat.opacity = 0;
        dotMat.opacity = 0;
      }
    },
    dispose() {
      [body, aperture, beam, dot].forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    },
  };
}

function makePaint() {
  const group = new THREE.Group();
  group.name = 'ee-paint';

  const bodyMat   = new THREE.MeshStandardMaterial({ color: 0x4a8cda, roughness: 0.5, metalness: 0.4 });
  const collarMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.7 });
  const tankMat   = new THREE.MeshStandardMaterial({ color: 0xdde3eb, roughness: 0.4, metalness: 0.3 });
  const sprayMat  = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, side: THREE.DoubleSide });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.09, 18), bodyMat);
  body.position.y = 0.045;
  body.castShadow = true;
  group.add(body);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.018, 16), collarMat);
  collar.position.y = 0.10;
  group.add(collar);

  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), tankMat);
  tank.position.set(0, 0.05, -0.045);
  tank.castShadow = true;
  group.add(tank);

  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 18, 1, true), sprayMat);
  cone.rotation.x = Math.PI;
  cone.position.y = 0.11 + 0.08;
  group.add(cone);

  const tip = new THREE.Object3D();
  tip.position.y = 0.115;
  group.add(tip);

  const params = { spraying: 0, color: 0xffffff };
  let t = 0;

  function setSprayColor(hex) {
    params.color = hex;
    sprayMat.color.setHex(hex);
  }

  return {
    type: 'paint',
    group, tip,
    pickables: [body, collar, tank],
    params,
    setParam(name, val) {
      if (name === 'spraying') params.spraying = +val ? 1 : 0;
      else if (name === 'color') setSprayColor(+val);
    },
    update(dt = 0.016) {
      t += dt;
      if (params.spraying) {
        sprayMat.opacity = 0.20 + 0.08 * Math.sin(t * 18);
      } else {
        sprayMat.opacity = 0;
      }
    },
    dispose() {
      [body, collar, tank, cone].forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    },
  };
}
