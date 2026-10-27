// RoboForge, (c) 2024-2026 Rishik Saravanan

import * as THREE from 'three';

const ALU       = 0xb8bdc4;
const ALU_DARK  = 0x6f7682;
const WOOD      = 0xd9b475;
const WOOD_DARK = 0x9a7a45;
const SCREEN    = 0x101218;
const RUBBER    = 0x1b1d22;
const COUNTER   = 0x3c3f48;
const HEX       = 0x202428;

const baseMat   = new THREE.MeshStandardMaterial({ color: ALU,      metalness: 0.7, roughness: 0.45 });
const baseDark  = new THREE.MeshStandardMaterial({ color: ALU_DARK, metalness: 0.7, roughness: 0.55 });
const woodMat   = new THREE.MeshStandardMaterial({ color: WOOD,     metalness: 0.0, roughness: 0.8  });
const woodDark  = new THREE.MeshStandardMaterial({ color: WOOD_DARK, metalness: 0.0, roughness: 0.85 });
const screenMat = new THREE.MeshStandardMaterial({ color: SCREEN,   metalness: 0.1, roughness: 0.25, emissive: 0x0a1622, emissiveIntensity: 0.6 });
const rubberMat = new THREE.MeshStandardMaterial({ color: RUBBER,   metalness: 0.1, roughness: 0.85 });
const counterMat= new THREE.MeshStandardMaterial({ color: COUNTER,  metalness: 0.7, roughness: 0.3  });
const blackMat  = new THREE.MeshStandardMaterial({ color: HEX,      metalness: 0.4, roughness: 0.55 });

export const DOSE_DIMS = {
  baseW: 0.55,
  baseD: 0.40,
  baseH: 0.36,
  wheelR: 0.115,
  wheelW: 0.055,
  mastH: 1.45,
  mastW: 0.10,
  shoulderHeight: 0.55,
  liftRange: 0.55,
};

export function buildDoseMesh() {
  const D = DOSE_DIMS;
  const root = new THREE.Group();
  root.name = 'dose-robot';

  const chassis = new THREE.Group();
  chassis.name = 'chassis';

  const body = new THREE.Mesh(new THREE.BoxGeometry(D.baseW, D.baseH, D.baseD), baseMat);
  body.position.y = D.wheelR + D.baseH / 2;
  body.castShadow = true; body.receiveShadow = true;
  chassis.add(body);

  const topPlate = new THREE.Mesh(new THREE.BoxGeometry(D.baseW * 1.02, 0.018, D.baseD * 1.02), woodMat);
  topPlate.position.y = D.wheelR + D.baseH + 0.009;
  topPlate.castShadow = true; topPlate.receiveShadow = true;
  chassis.add(topPlate);

  const trim = new THREE.Mesh(new THREE.BoxGeometry(D.baseW * 1.04, 0.012, D.baseD * 1.04), woodDark);
  trim.position.y = D.wheelR + D.baseH - 0.005;
  chassis.add(trim);

  const wheelGeom = new THREE.CylinderGeometry(D.wheelR, D.wheelR, D.wheelW, 24);
  wheelGeom.rotateZ(Math.PI / 2);
  const leftWheel  = new THREE.Mesh(wheelGeom, rubberMat);
  const rightWheel = new THREE.Mesh(wheelGeom, rubberMat);
  leftWheel.position.set( -(D.baseW / 2 + D.wheelW / 2 - 0.005), D.wheelR, 0.02);
  rightWheel.position.set( +(D.baseW / 2 + D.wheelW / 2 - 0.005), D.wheelR, 0.02);
  leftWheel.castShadow = rightWheel.castShadow = true;
  chassis.add(leftWheel); chassis.add(rightWheel);

  const hubGeom = new THREE.CylinderGeometry(D.wheelR * 0.45, D.wheelR * 0.45, D.wheelW * 1.05, 12);
  hubGeom.rotateZ(Math.PI / 2);
  const leftHub  = new THREE.Mesh(hubGeom, baseDark);
  const rightHub = new THREE.Mesh(hubGeom, baseDark);
  leftHub.position.copy(leftWheel.position);
  rightHub.position.copy(rightWheel.position);
  chassis.add(leftHub); chassis.add(rightHub);

  const casterArm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.04), baseDark);
  casterArm.position.set(0, D.wheelR * 0.7, -D.baseD / 2 + 0.04);
  chassis.add(casterArm);
  const caster = new THREE.Mesh(new THREE.SphereGeometry(D.wheelR * 0.55, 16, 12), rubberMat);
  caster.position.set(0, D.wheelR * 0.55, -D.baseD / 2 + 0.04);
  caster.castShadow = true;
  chassis.add(caster);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(D.mastW / 2, D.mastW / 2, D.mastH, 16),
    baseDark
  );
  mast.position.set(0, D.wheelR + D.baseH + D.mastH / 2, -D.baseD / 2 + D.mastW / 2 + 0.02);
  mast.castShadow = true;
  chassis.add(mast);

  const headGroup = new THREE.Group();
  headGroup.name = 'head';
  const headFrame = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.05), baseMat);
  headFrame.castShadow = true;
  headGroup.add(headFrame);
  const headScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.20), screenMat);
  headScreen.position.z = 0.026;
  headGroup.add(headScreen);
  const lensRing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12),
    blackMat
  );
  lensRing.rotation.x = Math.PI / 2;
  lensRing.position.set(0.12, -0.07, 0.027);
  headGroup.add(lensRing);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.008, 16), screenMat);
  lens.position.copy(lensRing.position); lens.position.z += 0.007;
  headGroup.add(lens);
  headGroup.position.set(0, D.wheelR + D.baseH + D.mastH - 0.05, -D.baseD / 2 + D.mastW + 0.04);
  chassis.add(headGroup);

  const liftSlide = new THREE.Group();
  liftSlide.name = 'lift-slide';
  liftSlide.position.set(0, D.wheelR + D.baseH + D.shoulderHeight, -D.baseD / 2 + D.mastW / 2 + 0.02);
  chassis.add(liftSlide);

  const liftCarriage = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.10, 0.10),
    counterMat
  );
  liftCarriage.position.z = 0.03;
  liftCarriage.castShadow = true;
  liftSlide.add(liftCarriage);

  // The reBot RS arm (js/robot.js Robot instance) is mounted directly onto
  // liftSlide by dose-main.js — the old SCARA shoulder/elbow/wrist/gripper
  // sub-tree it used to hold has been replaced by that arm's own CAD meshes.

  root.add(chassis);

  return {
    group: root,
    chassis,
    leftWheel, rightWheel, caster,
    head: headGroup,
    headScreen,
    liftSlide,
    liftCarriage,
  };
}
