/**
 * The URDF tab in the Arm Lab: drop a .zip, a folder or loose files, pick
 * which URDF to show if there are several, then pose it with sliders or by
 * dragging a link in the 3D view. Problems found while parsing (missing
 * meshes, broken trees, bad limits) are listed instead of failing silently.
 */

import * as THREE from 'three';
import { VFS, vfsFromFiles, filesFromDrop, baseOf } from './vfs.js';
import { parseURDF, movableJoints } from './parse.js';
import { UrdfRobot } from './build.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtBytes = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B';

export class UrdfPanel {
  /**
   * @param {{ scene: THREE.Scene, camera: THREE.PerspectiveCamera, orbit: any, renderer: THREE.WebGLRenderer,
   *           dropTarget: HTMLElement, onActive: (on: boolean) => void,
   *           loadOwnURDF: (text: string) => Promise<void>, loading: { show(msg?: string): void, hide(): void } }} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.robot = null;          // UrdfRobot on screen
    this.vfs = null;
    this.sliders = new Map();   // joint name → { input, out }
    this._wire();
    this._wireDrag();
  }

  get active() { return !!this.robot; }

  // ---------- input ----------

  _wire() {
    $('urdf-pick-files').addEventListener('click', () => this.pickFiles());
    $('urdf-pick-folder').addEventListener('click', () => { $('urdf-folder').value = ''; $('urdf-folder').click(); });
    $('urdf-files').addEventListener('change', (e) => this.openFiles([...e.target.files]));
    $('urdf-folder').addEventListener('change', (e) => this.openFiles([...e.target.files]));
    $('urdf-file-select').addEventListener('change', (e) => this.show(e.target.value));
    $('urdf-home').addEventListener('click', () => { this.robot?.setAll(this.robot.homePose()); this._syncSliders(); });
    $('urdf-frame').addEventListener('click', () => this.frame());
    $('urdf-close').addEventListener('click', () => this.close());
    for (const key of ['visual', 'collision', 'frames', 'axes', 'com']) {
      $(`urdf-show-${key}`).addEventListener('change', (e) => this.robot?.setShow(key, e.target.checked));
    }

    // Drag and drop anywhere on the 3D view or on the tab's drop zone.
    for (const el of [this.ctx.dropTarget, $('urdf-drop')]) {
      let depth = 0;
      el.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; el.classList.add('is-dropping'); });
      el.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
      el.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; el.classList.remove('is-dropping'); } });
      el.addEventListener('drop', async (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault(); depth = 0; el.classList.remove('is-dropping');
        this.openFiles(await filesFromDrop(e.dataTransfer));
      });
    }
  }

  pickFiles() {
    $('urdf-files').value = '';
    $('urdf-files').click();
  }

  /** Load whatever the user handed us. */
  async openFiles(files) {
    if (!files.length) return;
    document.querySelector('.tab[data-tab="urdf"]')?.click();
    this.ctx.loading.show('Unpacking…');
    try {
      const vfs = await vfsFromFiles(files);
      const urdfs = vfs.robotFiles();
      if (!urdfs.length) {
        throw new Error(vfs.files.size
          ? `I couldn't find a .urdf file in ${files.length === 1 ? files[0].name : 'those files'}. Found ${vfs.files.size} file${vfs.files.size === 1 ? '' : 's'}, none ending in .urdf.`
          : 'That was empty.');
      }
      // RoboForge's own exports go back into the editable arm.
      const first = vfs.text(urdfs[0]);
      if (urdfs.length === 1 && /<robot\s+name="roboforge_arm"/.test(first)) {
        this.close();
        await this.ctx.loadOwnURDF(first);
        this._status(`Loaded ${baseOf(urdfs[0])} into the editable arm.`);
        return;
      }
      this.vfs?.dispose();
      this.vfs = vfs;
      const sel = $('urdf-file-select');
      sel.innerHTML = urdfs.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
      $('urdf-file-row').hidden = urdfs.length < 2;
      this._listFiles();
      await this.show(urdfs.find(p => /\.urdf$/i.test(p)) || urdfs[0]);
    } catch (err) {
      console.warn('[RoboForge] URDF import failed:', err);
      this._status(err.message, true);
    } finally {
      this.ctx.loading.hide();
    }
  }

  /** Parse, build and show one URDF from the current package. */
  async show(path) {
    const text = this.vfs.text(path);
    $('urdf-file-select').value = path;
    this.ctx.loading.show('Reading URDF…');
    try {
      const model = parseURDF(text);
      if (!model.root) throw new Error(model.problems.find(p => p.level === 'error')?.msg || 'No base link.');
      const next = new UrdfRobot(model, this.vfs, path);
      await next.build((done, total) => total && this.ctx.loading.show(`Loading meshes ${done}/${total}…`));
      if (this.robot) this._removeRobot();
      this.robot = next;
      for (const key of Object.keys(next.show)) next.setShow(key, $(`urdf-show-${key}`).checked);
      this.ctx.scene.add(next.group);
      this.ctx.onActive(true);
      this._render(path);
      this.frame();
    } catch (err) {
      console.warn('[RoboForge] URDF build failed:', err);
      this._status(err.message, true);
    } finally {
      this.ctx.loading.hide();
    }
  }

  _removeRobot() {
    // The VFS belongs to the package, not the robot, so keep it for the next show().
    this.robot.vfs = new VFS();
    this.robot.dispose();
    this.robot = null;
  }

  close() {
    if (this.robot) this._removeRobot();
    this.vfs?.dispose(); this.vfs = null;
    $('urdf-loaded').hidden = true;
    this.ctx.onActive(false);
  }

  /** Point the camera at the whole robot. */
  frame() {
    if (!this.robot) return;
    const { camera, orbit } = this.ctx;
    this.robot.group.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    this.robot.group.traverse(o => { if (o.isMesh && o.visible && !o.parent?.isArrowHelper) box.expandByObject(o); });
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0.6, 0.6, 0.6));
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getBoundingSphere(new THREE.Sphere()).radius;
    const d = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
    const dir = new THREE.Vector3(1, 0.65, 1.15).normalize();
    orbit.target.copy(c);
    camera.position.copy(c).addScaledVector(dir, d);
    camera.near = Math.max(0.001, d / 200); camera.far = Math.max(50, d * 20);
    camera.updateProjectionMatrix();
    orbit.minDistance = Math.min(0.3, r * 0.3);
    orbit.update();
  }

  // ---------- panel ----------

  _status(msg, isError = false) {
    const el = $('urdf-status');
    el.textContent = msg;
    el.classList.toggle('is-error', isError);
    el.hidden = !msg;
  }

  _render(path) {
    const R = this.robot, m = R.model;
    $('urdf-loaded').hidden = false;
    this._status('');
    $('urdf-name').textContent = m.name;
    const movable = movableJoints(m);
    $('urdf-stats').textContent =
      `${m.links.size} links · ${m.joints.size} joints (${movable.length} movable) · ${R.stats.meshes} meshes · ${Math.round(R.stats.triangles).toLocaleString()} triangles`;

    // Problems: missing files first, they're the usual reason a robot looks wrong.
    const probs = [
      ...R.missing.map(f => ({ level: 'error', msg: `Missing mesh: ${f}` })),
      ...R.failed.map(f => ({ level: 'error', msg: `Couldn't read ${f.file}: ${f.error}` })),
      ...m.problems,
    ];
    const box = $('urdf-problems');
    box.hidden = !probs.length;
    box.innerHTML = probs.length
      ? `<p><strong>${probs.length} thing${probs.length === 1 ? '' : 's'} to check</strong> in ${esc(baseOf(path))}</p><ul>` +
        probs.slice(0, 40).map(p => `<li class="lvl-${p.level}">${esc(p.msg)}</li>`).join('') +
        (probs.length > 40 ? `<li>…and ${probs.length - 40} more</li>` : '') + '</ul>'
      : '';

    // Joint sliders.
    const host = $('urdf-joints');
    host.innerHTML = '';
    this.sliders.clear();
    if (!movable.length) host.innerHTML = '<p class="hint">Nothing to move: every joint is fixed.</p>';
    for (const j of movable) {
      const [lo, hi] = R.range(j);
      const row = document.createElement('div');
      row.className = 'urdf-joint';
      row.innerHTML = `<div class="head"><span class="name">${esc(j.name)}</span><span class="type">${j.type}</span><output></output></div>
        <input type="range" min="${lo}" max="${hi}" step="${j.type === 'prismatic' ? 0.0005 : 0.001}" ${lo === hi ? 'disabled' : ''} />`;
      const input = row.querySelector('input'), out = row.querySelector('output');
      input.addEventListener('input', () => { R.setJoint(j.name, +input.value); this._syncSliders(); });
      host.appendChild(row);
      this.sliders.set(j.name, { input, out, joint: j });
    }
    const mimics = [...m.joints.values()].filter(j => j.mimic);
    if (mimics.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Follow other joints: ' + mimics.map(j => `${j.name} (${j.mimic.multiplier}× ${j.mimic.joint})`).join(', ') + '.';
      host.appendChild(p);
    }
    this._syncSliders();
    this._tree();
  }

  _syncSliders() {
    for (const [name, s] of this.sliders) {
      const v = this.robot.getJoint(name);
      s.input.value = v;
      s.out.textContent = s.joint.type === 'prismatic'
        ? `${(v * 1000).toFixed(1)} mm`
        : `${THREE.MathUtils.radToDeg(v).toFixed(1)}°`;
    }
  }

  /** Link/joint tree, indented, like a ROS check_urdf printout. */
  _tree() {
    const m = this.robot.model;
    const lines = [];
    const walk = (link, depth) => {
      lines.push(`<li style="--d:${depth}"><span class="link">${esc(link)}</span></li>`);
      for (const j of m.childJoints.get(link) || []) {
        lines.push(`<li style="--d:${depth + 1}" class="joint">${esc(j.name)} <span>${j.type}</span></li>`);
        walk(j.child, depth + 2);
      }
    };
    for (const r of m.roots) walk(r, 0);
    $('urdf-tree').innerHTML = lines.join('');
  }

  _listFiles() {
    const rows = [...this.vfs.files.entries()].sort(([a], [b]) => a.localeCompare(b));
    let total = 0;
    $('urdf-file-list').innerHTML = rows.map(([p, b]) => { total += b.byteLength; return `<li><span>${esc(p)}</span><span>${fmtBytes(b.byteLength)}</span></li>`; }).join('');
    $('urdf-file-count').textContent = `${rows.length} files, ${fmtBytes(total)}`;
  }

  // ---------- drag a link to move its joint ----------

  _wireDrag() {
    const { renderer, camera, orbit } = this.ctx;
    const el = renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let drag = null;     // { J, origin, axis, plane, last, value, prismatic }
    let hover = null;

    const pointer = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };
    // The nearest movable joint at or above the link that was hit.
    const jointFor = (obj) => {
      if (!this.robot) return null;
      let linkName = null;
      for (let o = obj; o && !linkName; o = o.parent) if (this.robot.links.has(o.name) && this.robot.links.get(o.name).obj === o) linkName = o.name;
      const m = this.robot.model;
      for (let n = linkName; n && m.parentOf.has(n);) {
        const j = m.parentOf.get(n);
        if (this.sliders.has(j.name)) return this.robot.joints.get(j.name);
        n = j.parent;
      }
      return null;
    };
    const hit = () => {
      if (!this.robot) return null;
      const meshes = [];
      this.robot.group.traverse(o => { if (o.isMesh) meshes.push(o); });
      const h = ray.intersectObjects(meshes, false).find(h => {
        for (let o = h.object; o; o = o.parent) if (!o.visible) return false;
        return !h.object.parent?.isArrowHelper && !(h.object.parent?.isAxesHelper);
      });
      return h || null;
    };
    const setHover = (J) => {
      if (hover === J) return;
      const tint = (J, on) => J && J.motion.traverse(o => {
        if (!o.isMesh || !o.material?.emissive) return;
        if (on) { o.userData._e = o.material; o.material = o.material.clone(); o.material.emissive.setHex(0x4a2400); }
        else if (o.userData._e) { o.material.dispose(); o.material = o.userData._e; delete o.userData._e; }
      });
      tint(hover, false); tint(J, true);
      hover = J;
      el.style.cursor = J ? 'grab' : '';
    };

    el.addEventListener('pointerdown', (e) => {
      if (!this.robot || e.button !== 0) return;
      pointer(e);
      const h = hit();
      const J = h && jointFor(h.object);
      if (!J) return;
      const j = J.joint;
      J.frame.updateWorldMatrix(true, false);
      const origin = new THREE.Vector3().setFromMatrixPosition(J.frame.matrixWorld);
      const q = J.frame.getWorldQuaternion(new THREE.Quaternion());
      const axis = new THREE.Vector3(...j.axis).applyQuaternion(q).normalize();
      const prismatic = j.type === 'prismatic';
      let plane;
      if (prismatic) {
        // A plane that contains the slide axis and faces the camera as much as it can.
        const toCam = camera.position.clone().sub(origin);
        const n = toCam.sub(axis.clone().multiplyScalar(toCam.dot(axis))).normalize();
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, h.point);
      } else {
        plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, h.point);
      }
      const start = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (!start) return;
      e.stopImmediatePropagation();      // keep OrbitControls / the gizmo out of it
      drag = { J, origin, axis, plane, last: start, prismatic };
      orbit.enabled = false;
      try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      el.style.cursor = 'grabbing';
    }, true);

    el.addEventListener('pointermove', (e) => {
      if (!this.robot) return;
      pointer(e);
      if (!drag) { if (e.buttons === 0) { const h = hit(); setHover(h && jointFor(h.object)); } return; }
      const p = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!p) return;
      const { J, origin, axis } = drag;
      let delta;
      if (drag.prismatic) {
        // Undo the robot's scale so a drag of 1 cm on screen slides 1 cm.
        const s = new THREE.Vector3(); J.frame.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
        delta = p.clone().sub(drag.last).dot(axis) / (s.x || 1);
      } else {
        const a = drag.last.clone().sub(origin), b = p.clone().sub(origin);
        a.sub(axis.clone().multiplyScalar(a.dot(axis))); b.sub(axis.clone().multiplyScalar(b.dot(axis)));
        if (a.lengthSq() < 1e-10 || b.lengthSq() < 1e-10) { drag.last = p; return; }
        delta = Math.atan2(a.clone().cross(b).dot(axis), a.dot(b));
      }
      this.robot.setJoint(J.joint.name, J.value + delta);
      drag.last = p;
      this._syncSliders();
    });

    const end = (e) => {
      if (!drag) return;
      drag = null;
      orbit.enabled = true;
      try { el.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      el.style.cursor = hover ? 'grab' : '';
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', () => { if (!drag) setHover(null); });
  }
}

function hasFiles(e) {
  return [...(e.dataTransfer?.types || [])].includes('Files');
}
