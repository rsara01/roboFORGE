
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d12);
  scene.fog = new THREE.Fog(0x0a0d12, 8, 40);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
  camera.position.set(2.2, 1.8, 2.6);
  camera.lookAt(0, 0.5, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

let lastW = 0, lastH = 0;
  function resize() {
    const w = container.clientWidth | 0;
    const h = container.clientHeight | 0;
    if (w <= 0 || h <= 0) return;
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(container);
  }
  resize();

const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x202028, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(4, 6, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -4;
  sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4;
  sun.shadow.camera.bottom = -4;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 20;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x88aaff, 0.25);
  fill.position.set(-3, 2, -2);
  scene.add(fill);

const groundGeo = new THREE.PlaneGeometry(20, 20);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x1a2030, roughness: 0.95, metalness: 0.0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

const grid = new THREE.GridHelper(20, 40, 0x3a4a60, 0x222a36);
  grid.position.y = 0.001;
  grid.name = 'grid';
  scene.add(grid);

const worldAxes = new THREE.AxesHelper(0.4);
  worldAxes.position.y = 0.002;
  scene.add(worldAxes);

const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, 0.5, 0);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.minDistance = 0.3;
  orbit.maxDistance = 20;
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.zoomSpeed = 2.4;        // faster scroll-wheel zoom
  orbit.panSpeed = 1.2;

const transform = new TransformControls(camera, renderer.domElement);
  transform.size = 0.7;
  transform.setMode('rotate');
  scene.add(transform);
  transform.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
  });

const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function pickObject(event, candidates) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(candidates, true);
    return hits.length ? hits[0] : null;
  }

  return {
    scene, camera, renderer, orbit, transform,
    ground, grid, worldAxes,
    pickObject,
    resize,
  };
}