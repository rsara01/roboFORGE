

import * as THREE from 'three';

const FLOOR_FLAT = 0xc6cbd6;
const FLOOR_HOSP = 0xe6ecf3;
const WALL_HOSP  = 0xeef4f9;
const TILE_LINE  = 0xd2dae5;
const PILLOW     = 0xfafafa;
const SHEET      = 0xb9d2e6;
const FRAME      = 0x8a99ac;
const TABLE_TOP  = 0xd9b475;
const TABLE_LEG  = 0x6f7682;
const ITEM_PILL  = 0xffd166;
const ITEM_VIAL  = 0x73c2fb;
const ITEM_BOX   = 0xff8c5a;

function buildAabbFromMesh(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  return {
    minX: box.min.x, maxX: box.max.x,
    minZ: box.min.z, maxZ: box.max.z,
    minY: box.min.y, maxY: box.max.y,
  };
}

function makeLight(scene) {
  const sun = new THREE.DirectionalLight(0xffffff, 0.95);
  sun.position.set(8, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 60;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  return sun;
}

function makeGroundPlane(scene, color, size = 40) {
  const geo = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function gridLines(scene, size, step, color) {
  const grid = new THREE.GridHelper(size, size / step, color, color);
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  grid.position.y = 0.001;
  scene.add(grid);
  return grid;
}

export function buildFlatEnvironment(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const sun = makeLight(scene);
  scene.background = new THREE.Color(0xdee6f2);
  scene.fog = new THREE.Fog(0xdee6f2, 30, 90);

  const ground = makeGroundPlane(scene, FLOOR_FLAT, 60);
  group.add(ground);
  const grid = gridLines(scene, 60, 1, 0x9aa5b4);
  group.add(grid);

  const colliders = [];
  const interactables = [];

  for (let i = 0; i < 8; i++) {
    const r = 1.5 + Math.random() * 4;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r * 2;
    const z = Math.sin(a) * r * 2;
    const w = 0.5 + Math.random() * 0.6;
    const h = 0.4 + Math.random() * 0.8;
    const d = 0.5 + Math.random() * 0.6;
    const c = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: 0xa9b4c3, roughness: 0.8 })
    );
    c.position.set(x, h / 2, z);
    c.castShadow = c.receiveShadow = true;
    scene.add(c);
    colliders.push({ aabb: buildAabbFromMesh(c), mesh: c });
  }

  return {
    name: 'flat',
    group,
    sun,
    floorY: 0,
    colliders,
    interactables,
    dropZones: [],
    spawnPos: new THREE.Vector3(0, 0, 0),
    spawnHeading: 0,
  };
}

export function buildHospitalEnvironment(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const sun = makeLight(scene);
  sun.intensity = 0.7;
  scene.add(new THREE.HemisphereLight(0xffffff, 0.45));
  scene.background = new THREE.Color(0xeaf2f8);
  scene.fog = new THREE.Fog(0xeaf2f8, 25, 60);

  const roomW = 12, roomD = 10;
  const ground = makeGroundPlane(scene, FLOOR_HOSP, 60);
  group.add(ground);

  const tileGeom = new THREE.PlaneGeometry(roomW, roomD, 12, 10);
  const tileMat = new THREE.MeshStandardMaterial({ color: 0xf6f9fc, roughness: 0.6, metalness: 0.05 });
  const tiles = new THREE.Mesh(tileGeom, tileMat);
  tiles.rotation.x = -Math.PI / 2;
  tiles.position.y = 0.002;
  tiles.receiveShadow = true;
  scene.add(tiles);

  const lineMat = new THREE.LineBasicMaterial({ color: TILE_LINE });
  for (let x = -roomW / 2; x <= roomW / 2 + 1e-3; x += 1) {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.004, -roomD / 2),
      new THREE.Vector3(x, 0.004,  roomD / 2),
    ]);
    scene.add(new THREE.Line(g, lineMat));
  }
  for (let z = -roomD / 2; z <= roomD / 2 + 1e-3; z += 1) {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-roomW / 2, 0.004, z),
      new THREE.Vector3( roomW / 2, 0.004, z),
    ]);
    scene.add(new THREE.Line(g, lineMat));
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: WALL_HOSP, roughness: 0.85 });
  const wallH = 2.5, wallT = 0.15;
  const colliders = [];
  const wallSpecs = [
    { w: roomW + wallT * 2, d: wallT, x: 0,            z: -roomD / 2 - wallT / 2 },
    { w: roomW + wallT * 2, d: wallT, x: 0,            z:  roomD / 2 + wallT / 2 },
    { w: wallT, d: roomD,            x: -roomW / 2 - wallT / 2, z: 0 },
    { w: wallT, d: roomD,            x:  roomW / 2 + wallT / 2, z: 0 },
  ];
  for (const w of wallSpecs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w.w, wallH, w.d), wallMat);
    m.position.set(w.x, wallH / 2, w.z);
    m.castShadow = false; m.receiveShadow = true;
    scene.add(m);
    colliders.push({ aabb: buildAabbFromMesh(m), mesh: m, wall: true });
  }

  const bedGroup = new THREE.Group();
  bedGroup.position.set(-3.5, 0, 2.6);
  bedGroup.rotation.y = -Math.PI / 2;
  scene.add(bedGroup);

  const bedFrame = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.1, 0.95),
    new THREE.MeshStandardMaterial({ color: FRAME, roughness: 0.45, metalness: 0.4 })
  );
  bedFrame.position.y = 0.55;
  bedFrame.castShadow = bedFrame.receiveShadow = true;
  bedGroup.add(bedFrame);

  for (const [lx, lz] of [[-0.95, -0.45], [0.95, -0.45], [-0.95, 0.45], [0.95, 0.45]]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.55, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x6c7585, roughness: 0.4, metalness: 0.4 })
    );
    leg.position.set(lx, 0.275, lz);
    bedGroup.add(leg);
  }

  const mattress = new THREE.Mesh(
    new THREE.BoxGeometry(1.95, 0.18, 0.9),
    new THREE.MeshStandardMaterial({ color: SHEET, roughness: 0.85 })
  );
  mattress.position.y = 0.7;
  mattress.castShadow = mattress.receiveShadow = true;
  bedGroup.add(mattress);

  const pillow = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.10, 0.4),
    new THREE.MeshStandardMaterial({ color: PILLOW, roughness: 0.95 })
  );
  pillow.position.set(-0.6, 0.84, 0);
  bedGroup.add(pillow);

  const headboard = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.7, 0.95),
    new THREE.MeshStandardMaterial({ color: FRAME, roughness: 0.5, metalness: 0.3 })
  );
  headboard.position.set(-1.0, 1.0, 0);
  bedGroup.add(headboard);

  colliders.push({ aabb: buildAabbFromMesh(bedFrame), mesh: bedFrame });

  const tableGroup = new THREE.Group();
  tableGroup.position.set(3.0, 0, -2.0);
  scene.add(tableGroup);

  const tableTop = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.05, 0.7),
    new THREE.MeshStandardMaterial({ color: TABLE_TOP, roughness: 0.7 })
  );
  tableTop.position.y = 0.78;
  tableTop.castShadow = tableTop.receiveShadow = true;
  tableGroup.add(tableTop);

  for (const [lx, lz] of [[-0.65, -0.30], [0.65, -0.30], [-0.65, 0.30], [0.65, 0.30]]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.78, 0.05),
      new THREE.MeshStandardMaterial({ color: TABLE_LEG, roughness: 0.5, metalness: 0.3 })
    );
    leg.position.set(lx, 0.39, lz);
    tableGroup.add(leg);
  }
  colliders.push({ aabb: buildAabbFromMesh(tableTop), mesh: tableTop, table: true });

  const interactables = [];
  const itemSpecs = [
    { type: 'pill',  color: ITEM_PILL, w: 0.10, h: 0.06, d: 0.10, label: 'PILL BOTTLE',  offsetX: -0.45, offsetZ: -0.18 },
    { type: 'vial',  color: ITEM_VIAL, w: 0.06, h: 0.14, d: 0.06, label: 'IV VIAL',      offsetX:  0.00, offsetZ: -0.18 },
    { type: 'box',   color: ITEM_BOX,  w: 0.18, h: 0.10, d: 0.12, label: 'GAUZE PACK',   offsetX:  0.45, offsetZ: -0.18 },
    { type: 'cup',   color: 0xeeeeee,  w: 0.08, h: 0.10, d: 0.08, label: 'WATER CUP',    offsetX: -0.30, offsetZ:  0.18 },
    { type: 'tray',  color: 0x6cd1c8,  w: 0.18, h: 0.05, d: 0.18, label: 'SAMPLE TRAY',  offsetX:  0.30, offsetZ:  0.18 },
  ];
  const tableTopY = 0.78 + 0.025;
  for (const s of itemSpecs) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(s.w, s.h, s.d),
      new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.7, metalness: 0.1 })
    );
    m.position.set(tableGroup.position.x + s.offsetX, tableTopY + s.h / 2, tableGroup.position.z + s.offsetZ);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    interactables.push({
      mesh: m,
      label: s.label,
      type: s.type,
      held: false,
      delivered: false,
      home: m.position.clone(),
    });
  }

  const dropZones = [];
  const dropMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.55, 32),
    new THREE.MeshBasicMaterial({ color: 0x66dd99, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
  );
  dropMarker.rotation.x = -Math.PI / 2;
  const dropPos = new THREE.Vector3(bedGroup.position.x + 1.4, 0.01, bedGroup.position.z);
  dropMarker.position.copy(dropPos);
  scene.add(dropMarker);
  dropZones.push({ position: dropPos, radius: 0.55, marker: dropMarker, name: 'BEDSIDE' });

  const monitorBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 1.4, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xc0c8d2, roughness: 0.6 })
  );
  monitorBase.position.set(-4.2, 0.7, 1.6);
  monitorBase.castShadow = monitorBase.receiveShadow = true;
  scene.add(monitorBase);
  const monitorScreen = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.36, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x12222e, emissive: 0x004f7f, emissiveIntensity: 0.5, roughness: 0.4 })
  );
  monitorScreen.position.set(-4.2, 1.5, 1.6);
  scene.add(monitorScreen);
  colliders.push({ aabb: buildAabbFromMesh(monitorBase), mesh: monitorBase });

  const cabinet = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 1.4, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xe8edf3, roughness: 0.7 })
  );
  cabinet.position.set(4.4, 0.7, 2.5);
  cabinet.castShadow = cabinet.receiveShadow = true;
  scene.add(cabinet);
  colliders.push({ aabb: buildAabbFromMesh(cabinet), mesh: cabinet });

  return {
    name: 'hospital',
    group,
    sun,
    floorY: 0,
    colliders,
    interactables,
    dropZones,
    table: tableGroup,
    bed: bedGroup,
    spawnPos: new THREE.Vector3(0, 0, -1),
    spawnHeading: 0,
    bounds: { minX: -roomW / 2 + 0.3, maxX: roomW / 2 - 0.3, minZ: -roomD / 2 + 0.3, maxZ: roomD / 2 - 0.3 },
  };
}

export function disposeEnvironment(env, scene) {
  if (!env) return;
  scene.traverse(() => {});
  const toRemove = [];
  scene.children.forEach((c) => {
    if (c.userData && c.userData.envOwned) toRemove.push(c);
  });
  toRemove.forEach((c) => scene.remove(c));
  while (scene.children.length > 0) {
    const c = scene.children[0];
    if (c.isCamera || c.userData?.persistent) break;
    scene.remove(c);
  }
}
