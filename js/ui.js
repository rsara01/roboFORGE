// RoboForge, (c) 2024-2026 Rishik Saravanan

import { EE_TYPES, EE_LABELS } from './endEffectors.js';
import { DEFAULT_COLORS } from './robot.js';
import { SCRIPT_EXAMPLES } from './scriptExamples.js';
import { computeJointTorques } from './dynamics.js';
import { toast, ask } from './notify.js';

const COLOR_FIELDS = [
  { key: 'revolute',     label: 'Revolute joint' },
  { key: 'revoluteDark', label: 'Revolute cap' },
  { key: 'prismatic',    label: 'Prismatic joint' },
  { key: 'prismaticDark',label: 'Prismatic trim' },
  { key: 'link',         label: 'Link' },
  { key: 'linkDark',     label: 'Link flange' },
  { key: 'base',         label: 'Base' },
  { key: 'baseDark',     label: 'Base trim' },
];

export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    this.elements = this._cacheEls();
    this._wire();
    this._populateEEAddSelect();
    this._buildColorGrid();
    this._loadExample('basic');
  }

  _cacheEls() {
    const $ = (id) => document.getElementById(id);
    return {
      hierarchy: $('hierarchy'),
      inspector: $('inspector'),
      jointSliders: $('joint-sliders'),
      eeAddSelect: $('ee-add-select'),
      eeAddBtn: $('ee-add-btn'),
      eeList: $('ee-list'),
      colorGrid: $('color-grid'),
      btnResetColors: $('btn-reset-colors'),
      blocksList: $('blocks-list'),
      btnSpawnBlock: $('btn-spawn-block'),
      torqueReadout: $('torque-readout'),
      robotsList: $('robots-list'),
      btnSpawnRobot: $('btn-spawn-robot'),
      selRow: $('sel-row'),
      selName: $('sel-name'),
      eePos: $('ee-pos'),
      simTime: $('sim-time'),
      simSpeedVal: $('sim-speed-val'),
      ikTrack: $('ik-track'),
      scriptRun: $('script-run'),
      scriptArea: $('script-area'),
      scriptExample: $('script-example'),
      tabs: document.querySelectorAll('.tab'),
      tabPanels: document.querySelectorAll('.tab-panel'),
      gizmoBtns: document.querySelectorAll('.overlay-gizmo-mode button'),
    };
  }

  _populateEEAddSelect() {
    const sel = this.elements.eeAddSelect;
    sel.innerHTML = '';
    for (const t of EE_TYPES) {
      if (t === 'none') continue;
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = EE_LABELS[t] || t;
      sel.appendChild(opt);
    }
  }

  _buildColorGrid() {
    const wrap = this.elements.colorGrid;
    wrap.innerHTML = '';
    for (const f of COLOR_FIELDS) {
      const row = document.createElement('label');
      row.innerHTML = `<span>${f.label}</span><input type="color" data-key="${f.key}" value="${this._hex(f.key)}"/>`;
      row.querySelector('input').addEventListener('input', (e) => {
        this.ctx.robot.setColor(f.key, parseInt(e.target.value.slice(1), 16));
      });
      wrap.appendChild(row);
    }
  }

  _hex(key) {
    return '#' + (this.ctx.robot.colors[key] ?? DEFAULT_COLORS[key]).toString(16).padStart(6, '0');
  }

  refreshColorGrid() {
    for (const inp of this.elements.colorGrid.querySelectorAll('input[type="color"]')) inp.value = this._hex(inp.dataset.key);
  }

  _wire() {
    const { ctx } = this;
    const $ = (id) => document.getElementById(id);

    document.querySelectorAll('.builder-btn[data-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.add;
        if (ctx.robot.isUrdf) {
          toast('An imported robot keeps its URDF joints. Choose a preset to build your own.');
          return;
        }
        if (kind === 'revolute') ctx.robot.addJoint({ type: 'revolute' });
        else if (kind === 'prismatic') ctx.robot.addJoint({ type: 'prismatic' });
        else if (kind === 'link') {
          const last = ctx.robot.joints[ctx.robot.joints.length - 1];
          if (last) {
            last.link.length += 0.15;
            ctx.robot.rebuildJointGeometry(last);
          } else {
            const j = ctx.robot.addJoint({ type: 'revolute', min: 0, max: 0 });
            if (j) j.name = 'Fixed';
          }
        }
        ctx.refreshUI();
      });
    });

    $('btn-clear').addEventListener('click', async () => {
      if (!(await ask('Remove every joint from this robot?', 'Clear'))) return;
      ctx.robot.clear();
      ctx.onSelect(null);
      ctx.refreshUI();
    });

    $('preset-select').addEventListener('change', (e) => {
      const preset = e.target.value;
      if (!preset) return;
      ctx.loadPreset(preset);
      e.target.value = '';
    });

    this.elements.eeAddBtn.addEventListener('click', () => {
      ctx.addEndEffector(this.elements.eeAddSelect.value);
      this.refreshEEList();
      this.refreshHierarchy();
    });

    this.elements.btnResetColors.addEventListener('click', () => {
      ctx.robot.resetColors();
      this.refreshColorGrid();
    });

    this.elements.btnSpawnBlock.addEventListener('click', () => {
      this._gravityOn();
      const r = 0.4 + Math.random() * 0.2;
      const a = Math.random() * Math.PI * 2;
      ctx.physics.spawnBox({ x: Math.cos(a) * r, y: 0.05, z: Math.sin(a) * r }, 0.06, Math.floor(Math.random() * 0xffffff));
      this.refreshBlocksList();
    });
    $('btn-reset-blocks').addEventListener('click', () => {
      ctx.physics.resetBlocks();
      this._gravityOn();
      this.refreshBlocksList();
    });

    this.elements.btnSpawnRobot.addEventListener('click', () => {
      ctx.spawnRobot?.();
      this.refreshRobotsList();
    });

    const conv = ctx.conveyor;
    if (conv) {
      const speedVal = $('conveyor-speed-val');
      $('opt-conveyor').addEventListener('change', (e) => {
        conv.setEnabled(e.target.checked);
        if (e.target.checked) this._gravityOn();
        this.refreshBlocksList();
      });
      $('conveyor-speed').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        conv.setSpeed(v);
        speedVal.textContent = v.toFixed(2) + ' m/s';
      });
    }

    $('opt-axes').addEventListener('change', (e) => ctx.robot.setShowAxes(e.target.checked));
    $('opt-trace').addEventListener('change', (e) => ctx.setTraceEnabled(e.target.checked));
    $('btn-clear-trace').addEventListener('click', () => ctx.clearTrace());
    $('opt-grid').addEventListener('change', (e) => { ctx.scene3d.grid.visible = e.target.checked; });
    $('opt-physics').addEventListener('change', (e) => {
      ctx.physics.setEnabled(e.target.checked);
      if (e.target.checked && ctx.physics.bodies.length === 0) ctx.physics.spawnDefaultBlocks();
    });
    $('opt-floor').addEventListener('change', (e) => { ctx.robot.floorClearance = e.target.checked; });
    $('opt-selfcoll').addEventListener('change', (e) => { ctx.robot.selfCollision = e.target.checked; });

    this.elements.tabs.forEach(tab => tab.addEventListener('click', () => this.showTab(tab.dataset.tab)));

    this.elements.gizmoBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        ctx.setGizmoMode(btn.dataset.gizmo);
        this.elements.gizmoBtns.forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    $('sim-play').addEventListener('click', () => ctx.sim.play());
    $('sim-pause').addEventListener('click', () => ctx.sim.pause());
    $('sim-step').addEventListener('click', () => ctx.sim.step());
    $('sim-stop').addEventListener('click', () => ctx.sim.stop());
    $('sim-dt').addEventListener('change', (e) => { ctx.sim.dt = Math.max(0.001, parseFloat(e.target.value) || 0.016); });
    $('sim-speed').addEventListener('input', (e) => {
      ctx.sim.speed = parseFloat(e.target.value);
      this.elements.simSpeedVal.textContent = ctx.sim.speed.toFixed(1) + '×';
    });

    $('ik-solve').addEventListener('click', () => ctx.ikSolveOnce());
    this.elements.ikTrack.addEventListener('click', () => {
      if (ctx.ikTracker.active) ctx.ikStopTracking(); else ctx.ikStartTracking();
      this.syncIkTrack();
    });
    $('ik-cycle').addEventListener('click', () => ctx.ikCycleSolution());
    $('ik-show-target').addEventListener('change', (e) => ctx.setIKTargetVisible(e.target.checked));

    this.elements.scriptRun.addEventListener('click', () => {
      if (this._scriptRunning) ctx.stopScript(); else ctx.runScript();
    });
    this.elements.scriptExample.addEventListener('change', async (e) => {
      const k = e.target.value;
      if (!k || !SCRIPT_EXAMPLES[k]) return;
      const area = this.elements.scriptArea;
      const edited = area.value.trim() && area.value !== this._scriptBase;
      if (edited && !(await ask('Replace your script with this example?', 'Replace'))) {
        e.target.value = this._scriptKey || '';
        return;
      }
      this._loadExample(k);
    });

    $('plot-clear').addEventListener('click', () => ctx.plot.clear());
    $('plot-running').addEventListener('change', (e) => { ctx.plot.recording = e.target.checked; });

    $('btn-new').addEventListener('click', async () => {
      if (!(await ask('Start a new robot? Unsaved changes are lost.', 'New robot'))) return;
      ctx.newRobot();
    });
    $('btn-save').addEventListener('click', () => ctx.saveJSON());
    $('btn-load').addEventListener('click', () => ctx.loadFromFile('json'));
    $('btn-export-urdf').addEventListener('click', () => ctx.exportURDF());
    $('btn-import-urdf').addEventListener('click', () => ctx.loadFromFile('urdf'));

    // Settings popover: accent, sound, shortcuts.
    const gear = $('btn-settings'), pop = $('settings-pop');
    const setPop = (open) => { pop.hidden = !open; gear.setAttribute('aria-expanded', String(open)); };
    gear.addEventListener('click', (e) => { e.stopPropagation(); setPop(pop.hidden); });
    document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target)) setPop(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setPop(false); });

    const modal = $('help-modal');
    $('btn-help').addEventListener('click', () => { setPop(false); modal.classList.remove('hidden'); });
    $('help-close').addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  }

  _gravityOn() {
    this.ctx.physics.setEnabled(true);
    document.getElementById('opt-physics').checked = true;
  }

  showTab(name) {
    this.elements.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    this.elements.tabPanels.forEach(p => p.classList.toggle('active', p.dataset.panel === name));
  }

  _loadExample(key) {
    const src = SCRIPT_EXAMPLES[key];
    if (!src) return;
    this.elements.scriptArea.value = src;
    this.elements.scriptExample.value = key;
    this._scriptBase = src;
    this._scriptKey = key;
  }

  /** Put a script in the editor that isn't one of the examples. */
  setScript(src) {
    this.elements.scriptArea.value = src;
    this.elements.scriptExample.value = '';
    this._scriptBase = src;
    this._scriptKey = '';
  }

  setScriptRunning(on) {
    this._scriptRunning = on;
    this.elements.scriptRun.textContent = on ? 'Stop' : 'Run';
    this.elements.scriptRun.classList.toggle('primary', !on);
  }

  syncIkTrack() {
    const on = !!this.ctx.ikTracker.active;
    this.elements.ikTrack.textContent = on ? 'Stop tracking' : 'Track target';
    this.elements.ikTrack.classList.toggle('active', on);
  }

  refreshAll() {
    this.refreshHierarchy();
    this.refreshSliders();
    this.refreshInspector();
    this.refreshEEList();
    this.refreshColorGrid();
    this.refreshBlocksList();
    this.refreshRobotsList();
    this.syncIkTrack();
    this.ctx.plot.setRobot(this.ctx.robot);
  }

  refreshRobotsList() {
    const wrap = this.elements.robotsList;
    const robots = this.ctx.robots || [];
    const activeIdx = this.ctx.activeRobotIdx ?? 0;
    wrap.innerHTML = '';
    robots.forEach((r, i) => {
      const name = r.isUrdf ? r.name : `Arm ${i + 1}`;
      const card = document.createElement('div');
      card.className = 'robot-card' + (i === activeIdx ? ' active' : '');
      card.innerHTML = `
        <span class="rb-name">${escapeHtml(name)}</span>
        <span class="rb-dof">${r.joints?.length || 0} DoF</span>
        ${robots.length > 1 ? `<button class="x" title="Remove ${escapeHtml(name)}" aria-label="Remove ${escapeHtml(name)}">×</button>` : '<span></span>'}
      `;
      card.addEventListener('click', (e) => {
        if (e.target.matches('button.x')) return;
        if (i !== activeIdx) this.ctx.setActiveRobot?.(i);
      });
      card.querySelector('button.x')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await ask(`Remove ${name}?`, 'Remove')) this.ctx.removeRobot?.(i);
      });
      wrap.appendChild(card);
    });
  }

  refreshBlocksList() {
    const wrap = this.elements.blocksList;
    const bodies = this.ctx.physics?.bodies || [];
    this._blocksSig = this._blockSignature();
    wrap.innerHTML = '';
    if (bodies.length === 0) {
      wrap.innerHTML = '<p class="empty">No blocks.</p>';
      return;
    }
    bodies.forEach((body, idx) => {
      const row = document.createElement('div');
      row.className = 'block-row';
      const hex = '#' + body.mesh.material.color.getHex().toString(16).padStart(6, '0');
      row.innerHTML = `
        <span class="sw" style="background:${hex}"></span>
        <span>Block ${idx + 1}${body.attachedTo ? ' <span class="state">held</span>' : ''}</span>
        <input type="number" step="0.01" min="0" value="${(body.mass ?? 0.05).toFixed(2)}" aria-label="Mass of block ${idx + 1} (kg)"/>
        <button class="x" aria-label="Delete block ${idx + 1}">×</button>
      `;
      row.querySelector('input').addEventListener('change', (e) => {
        body.mass = Math.max(0, parseFloat(e.target.value) || 0);
      });
      row.querySelector('button.x').addEventListener('click', () => {
        body.mesh.removeFromParent();
        body.mesh.geometry.dispose();
        body.mesh.material.dispose();
        const i = this.ctx.physics.bodies.indexOf(body);
        if (i >= 0) this.ctx.physics.bodies.splice(i, 1);
        this.refreshBlocksList();
      });
      wrap.appendChild(row);
    });
  }

  /** Changes whenever a block appears, disappears or is picked up / put down. */
  _blockSignature() {
    const bodies = this.ctx.physics?.bodies || [];
    return bodies.map(b => (b.attachedTo ? 'h' : 'f')).join('') + bodies.length;
  }

  refreshTorques() {
    const wrap = this.elements.torqueReadout;
    const rows = computeJointTorques(this.ctx.robot, this.ctx.physics);
    if (rows.length === 0) {
      wrap.innerHTML = '<em>No joints</em>';
      return;
    }
    wrap.innerHTML = rows.map(r => {
      const isRev = r.type === 'revolute';
      const val = isRev ? `${r.torqueNm.toFixed(2)} N·m` : `${r.axialN.toFixed(2)} N`;
      const hi = Math.abs(isRev ? r.torqueNm : r.axialN) > 5;
      return `<div class="torque-row"><span>${escapeHtml(r.name)}</span><span class="name">${isRev ? 'τ' : 'F'} ${r.axis.toUpperCase()}</span><span class="val${hi ? ' hi' : ''}">${val}</span></div>`;
    }).join('');
  }

  refreshHierarchy() {
    const robot = this.ctx.robot;
    const root = this.elements.hierarchy;
    root.innerHTML = '';
    const node = (html, cls, idx) => {
      const el = document.createElement('div');
      el.className = 'tree-node ' + cls;
      el.innerHTML = html;
      el.dataset.idx = idx;
      root.appendChild(el);
      return el;
    };

    node('Base', 'link base', 0);
    robot.joints.forEach((j, i) => {
      const indent = '  '.repeat(i + 1);
      const jEl = node(`${indent}<span class="badge">${j.type === 'revolute' ? 'REV' : 'PRI'} ${j.axis.toUpperCase()}</span>${escapeHtml(j.name)}`, 'joint', i);
      if (this.ctx.selected === i) jEl.classList.add('selected');
      jEl.addEventListener('click', () => this.ctx.onSelect(i));
      node(`${indent}  <span class="badge">LINK</span>L${i + 1} ${j.link.length.toFixed(2)} m`, 'link', i)
        .addEventListener('click', () => this.ctx.onSelect(i));
    });
    robot.endEffectors.forEach((ee) => {
      node(`<span class="badge">TOOL</span>${escapeHtml(ee.label || EE_LABELS[ee.type] || ee.type)}`, 'ee', -1);
    });
  }

  refreshSliders() {
    const wrap = this.elements.jointSliders;
    wrap.innerHTML = '';
    const robot = this.ctx.robot;
    robot.joints.forEach((j, i) => {
      const unit = j.type === 'revolute' ? 'rad' : 'm';
      const row = document.createElement('div');
      row.className = 'joint-row';
      row.innerHTML = `
        <div class="head">
          <span>${escapeHtml(j.name)}<span class="kind">${j.type === 'revolute' ? 'revolute' : 'prismatic'} ${j.axis.toUpperCase()}</span></span>
          <span class="val" id="jv-${i}">${j.value.toFixed(3)} ${unit}</span>
        </div>
        <input type="range" min="${j.min}" max="${j.max}" step="0.001" value="${j.value}" aria-label="${escapeHtml(j.name)}" />
        <div class="vals">
          <label>value <input type="number" class="val-num" step="0.01" value="${j.value.toFixed(3)}" /></label>
          <label>min <input type="number" class="val-min" step="0.05" value="${j.min.toFixed(2)}" /></label>
          <label>max <input type="number" class="val-max" step="0.05" value="${j.max.toFixed(2)}" /></label>
        </div>
      `;
      const slider = row.querySelector('input[type=range]');
      const num = row.querySelector('.val-num');
      const show = () => { document.getElementById(`jv-${i}`).textContent = j.value.toFixed(3) + ' ' + unit; };

      slider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        robot.setJointValue(i, v);
        num.value = v.toFixed(3);
        show();
      });
      num.addEventListener('change', (e) => {
        robot.setJointValue(i, parseFloat(e.target.value));
        slider.value = j.value;
        show();
      });
      row.querySelector('.val-min').addEventListener('change', (e) => { j.min = parseFloat(e.target.value); slider.min = j.min; });
      row.querySelector('.val-max').addEventListener('change', (e) => { j.max = parseFloat(e.target.value); slider.max = j.max; });
      wrap.appendChild(row);
    });
  }

  refreshInspector() {
    const i = this.ctx.selected;
    const robot = this.ctx.robot;
    const insp = this.elements.inspector;
    if (i == null || !robot.joints[i]) {
      insp.innerHTML = '<em>No joint selected</em>';
      this.elements.selRow.hidden = true;
      return;
    }
    const j = robot.joints[i];
    this.elements.selName.textContent = j.name;
    this.elements.selRow.hidden = false;
    if (robot.isUrdf) { this._urdfInspector(robot, j, i); return; }
    const linkColorHex = '#' + (j.link.color ?? robot.colors.link ?? DEFAULT_COLORS.link).toString(16).padStart(6, '0');
    const sel = (v, cur) => (v === cur ? 'selected' : '');
    insp.innerHTML = `
      <div class="field"><label>Name</label><input type="text" id="i-name" value="${escapeHtml(j.name)}"/></div>
      <div class="field"><label>Type</label>
        <select id="i-type">
          <option value="revolute" ${sel('revolute', j.type)}>Revolute</option>
          <option value="prismatic" ${sel('prismatic', j.type)}>Prismatic</option>
        </select>
      </div>
      <div class="field"><label>Axis</label>
        <select id="i-axis">
          <option value="x" ${sel('x', j.axis)}>X</option>
          <option value="y" ${sel('y', j.axis)}>Y</option>
          <option value="z" ${sel('z', j.axis)}>Z</option>
        </select>
      </div>
      <div class="field"><label>Link length (m)</label><input type="number" step="0.05" id="i-len" value="${j.link.length.toFixed(3)}"/></div>
      <div class="field"><label>Link radius (m)</label><input type="number" step="0.005" id="i-rad" value="${j.link.radius.toFixed(3)}"/></div>
      <div class="field"><label>Link direction</label>
        <select id="i-link-axis">
          <option value="+y" ${sel('+y', j.link.axis || '+y')}>+Y (up)</option>
          <option value="-y" ${sel('-y', j.link.axis)}>−Y (down)</option>
          <option value="+x" ${sel('+x', j.link.axis)}>+X</option>
          <option value="-x" ${sel('-x', j.link.axis)}>−X</option>
          <option value="+z" ${sel('+z', j.link.axis)}>+Z</option>
          <option value="-z" ${sel('-z', j.link.axis)}>−Z</option>
        </select>
      </div>
      <div class="field"><label>Link color</label>
        <span class="inline">
          <input type="color" id="i-link-color" value="${linkColorHex}"/>
          <button id="i-link-color-clear" class="text-btn" ${j.link.color != null ? '' : 'disabled'}>Reset</button>
        </span>
      </div>
      <div class="field"><label>Min (${j.type === 'revolute' ? 'rad' : 'm'})</label><input type="number" step="0.05" id="i-min" value="${j.min.toFixed(3)}"/></div>
      <div class="field"><label>Max (${j.type === 'revolute' ? 'rad' : 'm'})</label><input type="number" step="0.05" id="i-max" value="${j.max.toFixed(3)}"/></div>
      <div class="field"><label>Value (${j.type === 'revolute' ? 'rad' : 'm'})</label><input type="number" step="0.01" id="i-val" value="${j.value.toFixed(3)}"/></div>
      <div class="field"><span></span><button id="i-delete" class="danger" title="Also deletes the joints after it">Delete joint</button></div>
    `;

    const on = (id, ev, fn) => insp.querySelector(id).addEventListener(ev, fn);
    on('#i-name', 'change', (e) => { j.name = e.target.value; this.refreshHierarchy(); this.refreshSliders(); });
    on('#i-type', 'change', (e) => { j.type = e.target.value; robot.rebuildJointGeometry(j); this.refreshHierarchy(); this.refreshSliders(); });
    on('#i-axis', 'change', (e) => { j.axis = e.target.value; robot.rebuildJointGeometry(j); this.refreshHierarchy(); });
    on('#i-len', 'change', (e) => { j.link.length = parseFloat(e.target.value); robot.rebuildJointGeometry(j); this.refreshHierarchy(); });
    on('#i-rad', 'change', (e) => { j.link.radius = parseFloat(e.target.value); robot.rebuildJointGeometry(j); });
    on('#i-link-axis', 'change', (e) => { j.link.axis = e.target.value; robot.rebuildJointGeometry(j); this.refreshHierarchy(); });
    on('#i-link-color', 'input', (e) => { j.link.color = parseInt(e.target.value.slice(1), 16); robot.rebuildJointGeometry(j); insp.querySelector('#i-link-color-clear').disabled = false; });
    on('#i-link-color-clear', 'click', () => { j.link.color = null; robot.rebuildJointGeometry(j); this.refreshInspector(); });
    on('#i-min', 'change', (e) => { j.min = parseFloat(e.target.value); this.refreshSliders(); });
    on('#i-max', 'change', (e) => { j.max = parseFloat(e.target.value); this.refreshSliders(); });
    on('#i-val', 'change', (e) => { robot.setJointValue(i, parseFloat(e.target.value)); this.refreshSliders(); });
    on('#i-delete', 'click', () => {
      robot.removeJoint(j.id);
      this.ctx.onSelect(null);
      this.refreshAll();
    });
  }

  /** Inspector for a joint of an imported robot: its shape comes from the URDF, so only limits and value are editable. */
  _urdfInspector(robot, j, i) {
    const insp = this.elements.inspector;
    const unit = j.type === 'revolute' ? 'rad' : 'm';
    const ax = j.axisVec.toArray().map(v => +v.toFixed(3)).join(' ');
    const linkColorHex = '#' + (j.link.color ?? robot.colors.link ?? 0xb9bcc1).toString(16).padStart(6, '0');
    const role = j.role === 'arm' ? '' : j.role === 'gripper' ? ', gripper' : ', not used by IK';
    insp.innerHTML = `
      <div class="field"><label>Name</label><input type="text" id="i-name" value="${escapeHtml(j.name)}"/></div>
      <div class="field"><label>URDF joint</label><span class="num">${escapeHtml(j.urdfName)}</span></div>
      <div class="field"><label>Type</label><span>${j.urdfType}${role}</span></div>
      <div class="field"><label>Axis</label><span class="num">${ax}</span></div>
      <div class="field"><label>To next joint</label><span class="num">${(j.link.length * 100).toFixed(1)} cm</span></div>
      <div class="field"><label>Link color</label>
        <span class="inline">
          <input type="color" id="i-link-color" value="${linkColorHex}"/>
          <button id="i-link-color-clear" class="text-btn" ${j.link.color != null ? '' : 'disabled'}>Reset</button>
        </span>
      </div>
      <div class="field"><label>Min (${unit})</label><input type="number" step="0.05" id="i-min" value="${j.min.toFixed(3)}"/></div>
      <div class="field"><label>Max (${unit})</label><input type="number" step="0.05" id="i-max" value="${j.max.toFixed(3)}"/></div>
      <div class="field"><label>Value (${unit})</label><input type="number" step="0.01" id="i-val" value="${j.value.toFixed(3)}"/></div>
    `;
    const on = (id, ev, fn) => insp.querySelector(id).addEventListener(ev, fn);
    on('#i-name', 'change', (e) => { j.name = e.target.value; this.refreshHierarchy(); this.refreshSliders(); });
    on('#i-link-color', 'input', (e) => { j.link.color = parseInt(e.target.value.slice(1), 16); robot.rebuildJointGeometry(j); insp.querySelector('#i-link-color-clear').disabled = false; });
    on('#i-link-color-clear', 'click', () => { j.link.color = null; robot.rebuildJointGeometry(j); this._urdfInspector(robot, j, i); });
    on('#i-min', 'change', (e) => { j.min = parseFloat(e.target.value); this.refreshSliders(); });
    on('#i-max', 'change', (e) => { j.max = parseFloat(e.target.value); this.refreshSliders(); });
    on('#i-val', 'change', (e) => { robot.setJointValue(i, parseFloat(e.target.value)); this.refreshSliders(); });
  }

  refreshEEList() {
    const robot = this.ctx.robot;
    const wrap = this.elements.eeList;
    wrap.innerHTML = '';
    robot.endEffectors.forEach((ee, idx) => {
      const card = document.createElement('div');
      card.className = 'ee-card';
      card.innerHTML = `
        <div class="ee-head">
          <span class="ee-title">${escapeHtml(ee.label || EE_LABELS[ee.type] || ee.type)}${idx === 0 ? ' <span class="pri-badge">Primary</span>' : ''}</span>
          <button class="text-btn">Remove</button>
        </div>
        <div class="ee-body"></div>
      `;
      this._renderEEControls(ee, card.querySelector('.ee-body'));
      card.querySelector('.ee-head button').addEventListener('click', () => {
        robot.removeEndEffector(idx);
        this.refreshEEList();
        this.refreshHierarchy();
      });
      wrap.appendChild(card);
    });
  }

  _renderEEControls(ee, wrap) {
    const physics = this.ctx.physics;
    const check = (attr, checked, label) => `<label><input type="checkbox" ${attr} ${checked ? 'checked' : ''}/> ${label}</label>`;
    if (ee.type === 'gripper' || ee.type === 'gripper3') {
      wrap.innerHTML = `<div class="field-row slider-row"><span>Open</span><input type="range" min="0" max="1" step="0.01" value="${ee.params.open}"/><output class="num">${Math.round(ee.params.open * 100)}%</output></div>`;
      const out = wrap.querySelector('output');
      wrap.querySelector('input').addEventListener('input', (e) => {
        ee.setParam('open', e.target.value);
        out.textContent = Math.round(e.target.value * 100) + '%';
      });
    } else if (ee.type === 'suction') {
      wrap.innerHTML = check('data-suct', ee.params.suction, 'Suction');
      wrap.querySelector('[data-suct]').addEventListener('change', (e) => ee.setParam('suction', e.target.checked));
    } else if (ee.type === 'welder') {
      wrap.innerHTML = check('data-w', ee.params.welding, 'Welding');
      wrap.querySelector('[data-w]').addEventListener('change', (e) => ee.setParam('welding', e.target.checked));
    } else if (ee.type === 'camera') {
      wrap.innerHTML = `${check('data-f', ee.params.showFrustum, 'Show field of view')}
        ${check('data-detect', ee.params.detect, 'Highlight what it sees')}
        <div class="row">
          <button data-scan>Scan</button>
          <button data-grab-orange>Find the orange block</button>
        </div>
        <div class="ee-info"></div>`;
      const info = wrap.querySelector('.ee-info');
      const runScan = () => {
        const hits = physics.scanBlocks(ee.tip, { fov: Math.PI / 3, range: 2.5 });
        for (const b of physics.bodies) physics.setBlockHighlight(b, false);
        if (ee.params.detect) for (const h of hits) physics.setBlockHighlight(h.body, true);
        info.textContent = hits.length === 0
          ? 'Nothing in view.'
          : `${hits.length} in view, closest ${hits[0].distance.toFixed(2)} m`;
        return hits;
      };
      wrap.querySelector('[data-f]').addEventListener('change', (e) => ee.setParam('showFrustum', e.target.checked));
      wrap.querySelector('[data-detect]').addEventListener('change', (e) => {
        ee.params.detect = !!e.target.checked;
        if (!ee.params.detect) for (const b of physics.bodies) physics.setBlockHighlight(b, false);
        else runScan();
      });
      wrap.querySelector('[data-scan]').addEventListener('click', runScan);
      wrap.querySelector('[data-grab-orange]').addEventListener('click', () => this.ctx.runScriptText(SCRIPT_EXAMPLES.grabOrange));

      if (ee._cameraTickHandle) clearInterval(ee._cameraTickHandle);
      ee._cameraTickHandle = setInterval(() => { if (ee.params.detect) runScan(); }, 250);
      if (!ee._cameraDisposeWrapped) {
        const origDispose = ee.dispose;
        ee.dispose = function () {
          if (this._cameraTickHandle) clearInterval(this._cameraTickHandle);
          for (const b of physics.bodies) physics.setBlockHighlight(b, false);
          origDispose?.call(this);
        };
        ee._cameraDisposeWrapped = true;
      }
    } else if (ee.type === 'drill') {
      wrap.innerHTML = `${check('data-s', ee.params.spinning, 'Spinning')}
        <label>Speed (rpm) <input type="number" data-rpm step="50" value="${ee.params.rpm}"/></label>`;
      wrap.querySelector('[data-s]').addEventListener('change', (e) => ee.setParam('spinning', e.target.checked));
      wrap.querySelector('[data-rpm]').addEventListener('change', (e) => ee.setParam('rpm', e.target.value));
    } else if (ee.type === 'magnet') {
      wrap.innerHTML = check('data-e', ee.params.energized, 'On');
      wrap.querySelector('[data-e]').addEventListener('change', (e) => ee.setParam('energized', e.target.checked));
    } else if (ee.type === 'laser') {
      wrap.innerHTML = check('data-fire', ee.params.firing, 'Firing');
      wrap.querySelector('[data-fire]').addEventListener('change', (e) => ee.setParam('firing', e.target.checked));
    } else if (ee.type === 'paint') {
      const colorHex = '#' + (ee.params.color || 0xffffff).toString(16).padStart(6, '0');
      wrap.innerHTML = `${check('data-spray', ee.params.spraying, 'Spraying')}
        <label>Color <input type="color" data-color value="${colorHex}"/></label>`;
      wrap.querySelector('[data-spray]').addEventListener('change', (e) => ee.setParam('spraying', e.target.checked));
      wrap.querySelector('[data-color]').addEventListener('input', (e) => ee.setParam('color', parseInt(e.target.value.slice(1), 16)));
    }
  }

  tickReadouts(eeWorld, simTime) {
    this.elements.eePos.textContent = `${eeWorld.x.toFixed(2)}, ${eeWorld.y.toFixed(2)}, ${eeWorld.z.toFixed(2)} m`;
    this.elements.simTime.textContent = simTime.toFixed(2);

    const robot = this.ctx.robot;
    for (let i = 0; i < robot.joints.length; i++) {
      const el = document.getElementById(`jv-${i}`);
      if (el) {
        const j = robot.joints[i];
        el.textContent = j.value.toFixed(3) + ' ' + (j.type === 'revolute' ? 'rad' : 'm');
      }
    }

    this._readoutTick = (this._readoutTick || 0) + 1;
    if (this._readoutTick % 12 === 0) {
      this.refreshTorques();
      if (this._blockSignature() !== this._blocksSig) this.refreshBlocksList();
      if (!!this.ctx.ikTracker.active !== (this.elements.ikTrack.textContent === 'Stop tracking')) this.syncIkTrack();
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
