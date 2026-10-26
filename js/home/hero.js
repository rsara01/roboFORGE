/**
 * Live hero arm for the home page: the procedural arm from robot.js, driven by
 * the real CCD solver in ik.js. The IK target chases the cursor through a
 * slightly underdamped spring, so the arm overshoots a little and settles.
 * After a few idle seconds it starts tracing slow loops on its own.
 */

import * as THREE from 'three';
import { Robot } from '../robot.js';
import { solveIK } from '../ik.js';

const READY_POSE = [0.55, 0.7, 1.25, 0, 0.85, 0];
const IDLE_AFTER = 3.5;          // seconds without input before it entertains itself
const REACH = 0.8;               // m, kept a little inside the arm's real reach

/** Arm colours that read on both the light and dark viewport. */
const ARM_COLORS = {
  link: 0xd9d6cf, linkDark: 0x8d897f,
  revolute: 0x2c2d31, revoluteDark: 0x1d1e21,
  base: 0x3b3c40, baseDark: 0x27282b, bolt: 0x8d897f,
};

/**
 * Mount the hero scene into `stage`.
 * @param {{stage: HTMLElement, readout: HTMLElement, reduceMotion: MediaQueryList}} opts
 * @returns {{robot: Robot, scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer}}
 */
export function mountHero({ stage, readout, reduceMotion }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);
  const lookAt = new THREE.Vector3(0.12, 0.46, 0.04);
  const viewDir = new THREE.Vector3(0.62, 0.36, 0.7).normalize();
  /** Frame ~1.2 m of arm; on narrow (portrait) stages back off so its width fits. */
  function placeCamera(aspect) {
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(2.3, aspect < 1 ? 1.15 / (2 * half * aspect) : 0);
    camera.position.copy(lookAt).addScaledVector(viewDir, dist);
    camera.lookAt(lookAt);
  }
  placeCamera(1.4);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8577, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(2.2, 4.2, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -1.4, right: 1.4, top: 1.4, bottom: -1.4, near: 0.5, far: 10 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // The floor: a shadow catcher plus a grid. The only graph paper on the site.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  let grid = null;
  function buildGrid() {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    const c = getComputedStyle(document.documentElement).getPropertyValue('--floor-grid').trim() || '#d6d3cc';
    grid = new THREE.GridHelper(6, 48, c, c);
    grid.position.y = 0.001;
    scene.add(grid);
  }
  buildGrid();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', buildGrid);

  // The arm (same six-joint layout as the Arm Lab's default preset).
  const robot = new Robot(scene);
  robot.setShowAxes(false);
  robot.addJoint({ type: 'revolute', axis: 'y', linkLength: 0.20, linkAxis: '+y' });
  robot.addJoint({ type: 'revolute', axis: 'x', linkLength: 0.30, linkAxis: '+y' });
  robot.addJoint({ type: 'revolute', axis: 'x', linkLength: 0.25, linkAxis: '+y' });
  robot.addJoint({ type: 'revolute', axis: 'y', linkLength: 0.10, linkAxis: '+y' });
  robot.addJoint({ type: 'revolute', axis: 'x', linkLength: 0.10, linkAxis: '+y' });
  robot.addJoint({ type: 'revolute', axis: 'y', linkLength: 0.08, linkAxis: '+y' });
  for (const [k, v] of Object.entries(ARM_COLORS)) robot.setColor(k, v);
  robot.joints.forEach((j, i) => { j.value = READY_POSE[i]; robot._applyJointTransform(j); });
  robot.rootGroup.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  robot.rootGroup.updateWorldMatrix(true, true);

  // Live target marker (orange because it's the thing you control).
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0xf08327, roughness: 0.4, emissive: 0x3a1a00 }),
  );
  marker.visible = false;
  scene.add(marker);

  // Workspace: a sphere around the shoulder, above the floor, off the base axis.
  const shoulder = new THREE.Vector3();
  robot.joints[1].group.getWorldPosition(shoulder);
  function clampToWorkspace(p) {
    const d = p.clone().sub(shoulder);
    if (d.length() > REACH) p.copy(shoulder).addScaledVector(d.normalize(), REACH);
    p.y = Math.max(p.y, 0.07);
    const r = Math.hypot(p.x, p.z);
    if (r < 0.16) { const s = 0.16 / Math.max(r, 1e-4); p.x *= s; p.z *= s; if (r < 1e-4) p.x = 0.16; }
    return p;
  }

  // Target + spring state.
  const goal = new THREE.Vector3();
  robot.getEndEffectorWorldPosition(goal);
  const pos = goal.clone();
  const vel = new THREE.Vector3();

  // Pointer → a plane that faces the camera through the arm's centre.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  let lastInput = -Infinity;
  function aim(ev) {
    const r = stage.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const n = camera.position.clone().sub(lookAt).setY(0).normalize();
    plane.setFromNormalAndCoplanarPoint(n, new THREE.Vector3(0.1, 0, 0.1));
    if (ray.ray.intersectPlane(plane, hit)) {
      goal.copy(clampToWorkspace(hit.clone()));
      lastInput = clock.elapsedTime;
      marker.visible = true;
    }
  }
  stage.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') aim(e); });
  stage.addEventListener('pointerdown', aim);
  stage.addEventListener('pointerleave', () => { lastInput = Math.min(lastInput, clock.elapsedTime - IDLE_AFTER + 1); });

  // Idle behaviour: slow figure-eights in front of the arm.
  function idleGoal(t) {
    const a = t * 0.55;
    return clampToWorkspace(new THREE.Vector3(
      0.32 + 0.18 * Math.sin(a),
      0.42 + 0.14 * Math.sin(2 * a),
      0.22 + 0.22 * Math.cos(a),
    ));
  }

  // Readout.
  let readoutT = 0;
  function writeReadout() {
    readout.textContent = robot.joints.map((j, i) => {
      const deg = THREE.MathUtils.radToDeg(j.value);
      return `j${i + 1} ${((deg < 0 ? '−' : '+') + Math.abs(deg).toFixed(1)).padStart(7, ' ')}°`;
    }).join('\n');
  }

  // Size.
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    placeCamera(w / h);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // Only run while visible.
  let onScreen = true;
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (onScreen) clock.getDelta(); }, { threshold: 0.01 })
    .observe(stage);

  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    if (!onScreen || document.hidden) return;
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const t = clock.elapsedTime;

    const idle = t - lastInput > IDLE_AFTER && !reduceMotion.matches;
    if (idle) { goal.copy(idleGoal(t)); marker.visible = false; }

    // Spring towards the goal. Reduced motion: critically damped, no overshoot.
    const k = 70, c = reduceMotion.matches ? 2 * Math.sqrt(k) : 10.5;
    const acc = goal.clone().sub(pos).multiplyScalar(k).addScaledVector(vel, -c);
    vel.addScaledVector(acc, dt);
    pos.addScaledVector(vel, dt);
    marker.position.copy(goal);

    solveIK(robot, pos, { maxIter: 4, tolerance: 0.003 });

    readoutT -= dt;
    if (readoutT <= 0) { writeReadout(); readoutT = 0.08; }
    renderer.render(scene, camera);
  }
  writeReadout();
  renderer.render(scene, camera);
  stage.classList.add('is-live');
  frame();

  return { robot, scene, camera, renderer };
}
