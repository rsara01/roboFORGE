/**
 * The URDF tab in the Arm Lab: drop a .zip, a folder or loose files, pick
 * which URDF to use if there are several, and the robot becomes the active
 * arm, so the inspector, IK, scripts, recording and grabbing all drive it.
 * This tab shows what was imported (problems, tool tip, joint roles, files)
 * and lets you pose the robot by dragging its parts in the 3D view.
 */

import * as THREE from 'three';
import { vfsFromFiles, filesFromDrop, baseOf, VFS } from './vfs.js';
import { parseURDF } from './parse.js';
import { UrdfRobot } from './build.js';
import { packageKey, savePackage, loadPackage } from './store.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtBytes = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B';
const ROLE = { arm: 'arm', gripper: 'gripper', other: 'extra' };

export class UrdfPanel {
  /**
   * @param {{ camera: THREE.PerspectiveCamera, orbit: any, renderer: THREE.WebGLRenderer, dropTarget: HTMLElement,
   *           loading: { show(msg?: string): void, hide(): void },
   *           active: () => any, adopt: (urdf: UrdfRobot, meta: object) => any, remove: (arm: any) => void,
   *           loadOwnURDF: (text: string) => Promise<void>, jointsChanged: () => void }} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
    this._wire();
    this._wireDrag();
  }

  /** The active arm if it's an imported one. */
  get arm() { const a = this.ctx.active(); return a?.isUrdf ? a : null; }
  /** The active imported robot's scene tree (kept for scripts and tests). */
  get robot() { return this.arm?.urdf || null; }

  // ---------- input ----------

  _wire() {
    $('urdf-pick-files').addEventListener('click', () => this.pickFiles());
    $('urdf-pick-folder').addEventListener('click', () => { $('urdf-folder').value = ''; $('urdf-folder').click(); });
    $('urdf-files').addEventListener('change', (e) => this.openFiles([...e.target.files]));
    $('urdf-folder').addEventListener('change', (e) => this.openFiles([...e.target.files]));
    $('urdf-file-select').addEventListener('change', (e) => { const a = this.arm; if (a) this.show(a.urdf.vfs, e.target.value); });
    $('urdf-tip').addEventListener('change', (e) => { this.arm?.setTipLink(e.target.value); this.ctx.jointsChanged(); this.refresh(); });
    $('urdf-frame').addEventListener('click', () => this.frame());
    $('urdf-close').addEventListener('click', () => { const a = this.arm; if (a) this.ctx.remove(a); this.refresh(); });
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
        await this.ctx.loadOwnURDF(first);
        this._status(`Loaded ${baseOf(urdfs[0])} into the editable arm.`);
        this.refresh();
        return;
      }
      await this.show(vfs, urdfs.find(p => /\.urdf$/i.test(p)) || urdfs[0]);
    } catch (err) {
      console.warn('[RoboForge] URDF import failed:', err);
      this._status(err.message, true);
    } finally {
      this.ctx.loading.hide();
    }
  }

  /**
   * Parse and build one URDF from a package, then make it the active arm.
   * @param {VFS} vfs
   * @param {string} path
   * @param {object} [restore]  saved state from a .json (joint values, tool tip, end effectors)
   */
  async show(vfs, path, restore = null) {
    const text = vfs.text(path);
    this.ctx.loading.show('Reading URDF…');
    try {
      const model = parseURDF(text);
      if (!model.root) throw new Error(model.problems.find(p => p.level === 'error')?.msg || 'No base link.');
      const built = new UrdfRobot(model, vfs, path);
      await built.build((done, total) => total && this.ctx.loading.show(`Loading meshes ${done}/${total}…`));
      for (const key of Object.keys(built.show)) built.setShow(key, $(`urdf-show-${key}`).checked);
      const key = packageKey(vfs, path);
      this.ctx.adopt(built, { fileName: baseOf(path), urdfText: text, urdfPath: path, packageKey: key, restore });
      if (!restore) savePackage(key, vfs);        // remember it for saved .json files
      this._status('');
      this.refresh();
      this.frame();
      return true;
    } catch (err) {
      console.warn('[RoboForge] URDF build failed:', err);
      this._status(err.message, true);
      return false;
    } finally {
      this.ctx.loading.hide();
    }
  }

  /**
   * Rebuild an imported robot from a saved .json (version 4, kind "urdf").
   * Uses the package remembered in this browser; without it the robot still
   * loads from the saved URDF text, just without its meshes.
   */
  async restore(data) {
    const files = data.packageKey ? await loadPackage(data.packageKey) : null;
    const vfs = new VFS();
    if (files) for (const [p, b] of files) vfs.add(p, b);
    else vfs.add(data.urdfPath || data.fileName || 'robot.urdf', new TextEncoder().encode(data.urdfText || ''));
    const path = data.urdfPath && vfs.files.has(data.urdfPath) ? data.urdfPath : vfs.robotFiles()[0];
    if (!path) throw new Error('This save has no URDF in it.');
    const ok = await this.show(vfs, path, data);
    if (ok && !files) this._status(`Loaded ${data.name || 'the robot'} without its meshes: this browser doesn't have its package. Import the .zip again to see it properly.`, true);
    return ok;
  }

  /** Point the camera at the active imported robot. */
  frame() {
    const a = this.arm;
    if (!a) return;
    const { camera, orbit } = this.ctx;
    a.rootGroup.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    a.urdf.group.traverse(o => { if (o.isMesh && o.visible && !o.parent?.isArrowHelper) box.expandByObject(o); });
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

  /** Show the active imported robot (or the empty state). Called when the active arm changes. */
  refresh() {
    const a = this.arm;
    $('urdf-loaded').hidden = !a;
    if (!a) return;
    const R = a.urdf, m = R.model;
    $('urdf-name').textContent = m.name;
    $('urdf-stats').textContent =
      `${m.links.size} links · ${m.joints.size} joints · ${R.stats.meshes} meshes · ${Math.round(R.stats.triangles).toLocaleString()} triangles`;
    for (const key of Object.keys(R.show)) $(`urdf-show-${key}`).checked = R.show[key];

    const urdfs = R.vfs.robotFiles();
    $('urdf-file-row').hidden = urdfs.length < 2;
    $('urdf-file-select').innerHTML = urdfs.map(p => `<option value="${esc(p)}" ${p === R.urdfPath ? 'selected' : ''}>${esc(p)}</option>`).join('');

    // Problems: missing files first, they're the usual reason a robot looks wrong.
    const probs = [
      ...R.missing.map(f => ({ level: 'error', msg: `Missing mesh: ${f}` })),
      ...R.failed.map(f => ({ level: 'error', msg: `Couldn't read ${f.file}: ${f.error}` })),
      ...m.problems,
    ];
    const box = $('urdf-problems');
    box.hidden = !probs.length;
    box.innerHTML = probs.length
      ? `<p><strong>${probs.length} thing${probs.length === 1 ? '' : 's'} to check</strong> in ${esc(baseOf(R.urdfPath))}</p><ul>` +
        probs.slice(0, 40).map(p => `<li class="lvl-${p.level}">${esc(p.msg)}</li>`).join('') +
        (probs.length > 40 ? `<li>…and ${probs.length - 40} more</li>` : '') + '</ul>'
      : '';

    // Tool tip and how each joint is used.
    $('urdf-tip').innerHTML = [...m.links.keys()].map(n => `<option value="${esc(n)}" ${n === a.tipLink ? 'selected' : ''}>${esc(n)}</option>`).join('');
    $('urdf-roles').innerHTML = a.joints.map((j, i) =>
      `<li><span class="idx">${i}</span><span class="name">${esc(j.urdfName)}</span><span class="role role-${j.role}">${ROLE[j.role]}</span></li>`).join('')
      || '<li>Nothing to move: every joint is fixed.</li>';
    const mimics = [...m.joints.values()].filter(j => j.mimic);
    $('urdf-mimic').textContent = mimics.length
      ? 'Following other joints: ' + mimics.map(j => `${j.name} (${j.mimic.multiplier}× ${j.mimic.joint})`).join(', ') + '.'
      : '';

    this._tree(m);
    this._listFiles(R.vfs);
  }

  /** Link/joint tree, indented, like a ROS check_urdf printout. */
  _tree(m) {
    const lines = [];
    const walk = (link, depth) => {
      if (depth > 512) return;
      lines.push(`<li style="--d:${depth}"><span class="link">${esc(link)}</span></li>`);
      for (const j of m.childJoints.get(link) || []) {
        lines.push(`<li style="--d:${depth + 1}" class="joint">${esc(j.name)} <span>${j.type}</span></li>`);
        walk(j.child, depth + 2);
      }
    };
    for (const r of m.roots) walk(r, 0);
    $('urdf-tree').innerHTML = lines.join('');
  }

  _listFiles(vfs) {
    const rows = [...vfs.files.entries()].sort(([a], [b]) => a.localeCompare(b));
    let total = 0;
    $('urdf-file-list').innerHTML = rows.map(([p, b]) => { total += b.byteLength; return `<li><span>${esc(p)}</span><span>${fmtBytes(b.byteLength)}</span></li>`; }).join('');
    $('urdf-file-count').textContent = `${rows.length} files, ${fmtBytes(total)}`;
  }

  // ---------- drag a part of the active imported robot to move its joint ----------

  _wireDrag() {
    const { renderer, camera, orbit } = this.ctx;
    const el = renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let drag = null;     // { j, idx, origin, axis, plane, last, prismatic }
    let hover = null;    // a joint entry of the active arm

    const pointer = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };
    const hit = () => {
      const a = this.arm;
      if (!a) return null;
      const h = ray.intersectObjects(a.pickableObjects(), false)
        .find(h => { for (let o = h.object; o; o = o.parent) if (!o.visible) return false; return true; });
      if (!h) return null;
      const j = a.jointFromObject(h.object);
      return j ? { j, point: h.point } : null;
    };
    const tint = (j, on) => {
      const a = this.arm;
      if (!j || !a) return;
      for (const L of a.urdf.links.values()) {
        if (L.ownerJoint !== j) continue;
        L.visual.traverse(o => {
          if (!o.isMesh) return;
          if (on && !o.userData._e && o.material?.emissive) { o.userData._e = o.material; o.material = o.material.clone(); o.material.emissive.setHex(0x4a2400); }
          else if (!on && o.userData._e) { o.material.dispose(); o.material = o.userData._e; delete o.userData._e; }
        });
      }
    };
    const setHover = (j) => {
      if (hover === j) return;
      tint(hover, false); tint(j, true);
      hover = j;
      el.style.cursor = j ? 'grab' : '';
    };

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pointer(e);
      const h = hit();
      if (!h) return;
      const a = this.arm, j = h.j;
      j.group.updateWorldMatrix(true, false);
      const origin = new THREE.Vector3().setFromMatrixPosition(j.group.matrixWorld);
      const axis = j.axisVec.clone().transformDirection(j.group.matrixWorld);
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
      e.stopImmediatePropagation();      // keep OrbitControls / the gizmo / arm picking out of it
      drag = { j, idx: a.joints.indexOf(j), origin, axis, plane, last: start, prismatic };
      orbit.enabled = false;
      try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      el.style.cursor = 'grabbing';
    }, true);

    el.addEventListener('pointermove', (e) => {
      pointer(e);
      if (!drag) { if (e.buttons === 0) setHover(hit()?.j || null); return; }
      const a = this.arm;
      if (!a) { drag = null; orbit.enabled = true; return; }
      const p = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!p) return;
      const { j, origin, axis } = drag;
      let delta;
      if (drag.prismatic) delta = p.clone().sub(drag.last).dot(axis);
      else {
        const u = drag.last.clone().sub(origin), w = p.clone().sub(origin);
        u.sub(axis.clone().multiplyScalar(u.dot(axis))); w.sub(axis.clone().multiplyScalar(w.dot(axis)));
        if (u.lengthSq() < 1e-10 || w.lengthSq() < 1e-10) { drag.last = p; return; }
        delta = Math.atan2(u.clone().cross(w).dot(axis), u.dot(w));
      }
      a.setJointValue(drag.idx, j.value + delta);   // same limits and collision checks as the sliders
      drag.last = p;
      this.ctx.jointsChanged();
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
