

import { EE_TYPES, EE_LABELS } from './endEffectors.js';
import { DEFAULT_COLORS } from './robot.js';
import { SCRIPT_EXAMPLES } from './scriptExamples.js';
import { computeJointTorques } from './dynamics.js';

const COLOR_FIELDS = [
  { key: 'revolute',     label: 'Revolute joint' },
  { key: 'revoluteDark', label: 'Revolute trim' },
  { key: 'prismatic',    label: 'Prismatic joint' },
  { key: 'prismaticDark',label: 'Prismatic trim' },
  { key: 'link',         label: 'Link body' },
  { key: 'linkDark',     label: 'Link flange' },
  { key: 'base',         label: 'Base pedestal' },
  { key: 'baseDark',     label: 'Base trim' },
];

export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    this.elements = this._cacheEls();
    this._wire();
    this._populateEEAddSelect();
    this._buildColorGrid();
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
      btnRefreshBlocks: $('btn-refresh-blocks'),
      torqueReadout: $('torque-readout'),
      robotsList: $('robots-list'),
      btnSpawnRobot: $('btn-spawn-robot'),
      btnUploadJson: $('btn-upload-json'),
      robotDashboardStatus: $('robot-dashboard-status'),
      robotDashboardSummary: $('robot-dashboard-summary'),
      selName: $('sel-name'),
      eePos: $('ee-pos'),
      simTime: $('sim-time'),
      simDt: $('sim-dt'),
      simSpeed: $('sim-speed'),
      simSpeedVal: $('sim-speed-val'),
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
    const robot = this.ctx.robot;
    for (const f of COLOR_FIELDS) {
      const row = document.createElement('label');
      const hex = '#' + (robot.colors[f.key] ?? DEFAULT_COLORS[f.key]).toString(16).padStart(6, '0');
      row.innerHTML = `<span>${f.label}</span><input type="color" data-key="${f.key}" value="${hex}"/>`;
      const inp = row.querySelector('input');
      inp.addEventListener('input', (e) => {
        robot.setColor(f.key, parseInt(e.target.value.slice(1), 16));
      });
      wrap.appendChild(row);
    }
  }

  refreshColorGrid() {
    const robot = this.ctx.robot;
    for (const inp of this.elements.colorGrid.querySelectorAll('input[type="color"]')) {
      const key = inp.dataset.key;
      const hex = '#' + (robot.colors[key] ?? DEFAULT_COLORS[key]).toString(16).padStart(6, '0');
      inp.value = hex;
    }
  }

  _wire() {
    const { ctx } = this;

    document.querySelectorAll('.builder-btn[data-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.add;
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

    document.getElementById('btn-clear').addEventListener('click', () => {
      if (confirm('Clear the robot?')) {
        ctx.robot.clear();
        ctx.onSelect(null);
        ctx.refreshUI();
      }
    });

    document.getElementById('preset-select').addEventListener('change', (e) => {
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
      ctx.physics.setEnabled(true);
      const phys = document.getElementById('opt-physics');
      if (phys) phys.checked = true;
      const r = 0.4 + Math.random() * 0.2;
      const a = Math.random() * Math.PI * 2;
      ctx.physics.spawnBox(
        { x: Math.cos(a) * r, y: 0.05, z: Math.sin(a) * r },
        0.06,
        Math.floor(Math.random() * 0xffffff),
      );
      this.refreshBlocksList();
    });
    this.elements.btnRefreshBlocks.addEventListener('click', () => this.refreshBlocksList());

    if (this.elements.btnSpawnRobot) {
      this.elements.btnSpawnRobot.addEventListener('click', () => {
        ctx.spawnRobot?.();
        this.refreshRobotsList();
      });
    }

    const conv = ctx.conveyor;
    if (conv) {
      const optConv = document.getElementById('opt-conveyor');
      const speed = document.getElementById('conveyor-speed');
      const speedVal = document.getElementById('conveyor-speed-val');
      optConv.addEventListener('change', (e) => {
        conv.setEnabled(e.target.checked);
        if (e.target.checked) {
          ctx.physics.setEnabled(true);
          const phys = document.getElementById('opt-physics');
          if (phys) phys.checked = true;
        }
        this.refreshBlocksList();
      });
      speed.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        conv.setSpeed(v);
        speedVal.textContent = v.toFixed(2) + ' m/s';
      });
    }

    document.getElementById('opt-axes').addEventListener('change', (e) => {
      ctx.robot.setShowAxes(e.target.checked);
    });
    document.getElementById('opt-trace').addEventListener('change', (e) => {
      ctx.setTraceEnabled(e.target.checked);
    });
    document.getElementById('opt-grid').addEventListener('change', (e) => {
      ctx.scene3d.grid.visible = e.target.checked;
    });
    document.getElementById('opt-physics').addEventListener('change', (e) => {
      ctx.physics.setEnabled(e.target.checked);
      if (e.target.checked && ctx.physics.bodies.length === 0) {
        ctx.physics.spawnDefaultBlocks();
      }
    });
    document.getElementById('opt-floor').addEventListener('change', (e) => {
      ctx.robot.floorClearance = e.target.checked;
    });
    document.getElementById('opt-selfcoll').addEventListener('change', (e) => {
      ctx.robot.selfCollision = e.target.checked;
    });
    document.getElementById('btn-reset-blocks').addEventListener('click', () => {
      ctx.physics.resetBlocks();
      if (!ctx.physics.enabled) ctx.physics.setEnabled(true);
      const phys = document.getElementById('opt-physics');
      if (phys) phys.checked = ctx.physics.enabled;
      this.refreshBlocksList();
    });
    document.getElementById('btn-clear-trace').addEventListener('click', () => ctx.clearTrace());

    this.elements.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.elements.tabs.forEach(t => t.classList.remove('active'));
        this.elements.tabPanels.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
      });
    });

    this.elements.gizmoBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        ctx.setGizmoMode(btn.dataset.gizmo);
        this.elements.gizmoBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('sim-play').addEventListener('click', () => ctx.sim.play());
    document.getElementById('sim-pause').addEventListener('click', () => ctx.sim.pause());
    document.getElementById('sim-step').addEventListener('click', () => ctx.sim.step());
    document.getElementById('sim-stop').addEventListener('click', () => ctx.sim.stop());

    document.getElementById('sim-dt').addEventListener('change', (e) => {
      ctx.sim.dt = Math.max(0.001, parseFloat(e.target.value) || 0.016);
    });
    document.getElementById('sim-speed').addEventListener('input', (e) => {
      ctx.sim.speed = parseFloat(e.target.value);
      this.elements.simSpeedVal.textContent = ctx.sim.speed.toFixed(1) + 'x';
    });

    document.getElementById('ik-solve').addEventListener('click', () => ctx.ikSolveOnce());
    document.getElementById('ik-track').addEventListener('click', () => ctx.ikStartTracking());
    document.getElementById('ik-stop').addEventListener('click', () => ctx.ikStopTracking());
    document.getElementById('ik-show-target').addEventListener('change', (e) => {
      ctx.setIKTargetVisible(e.target.checked);
    });

    document.getElementById('script-run').addEventListener('click', () => ctx.runScript());
    document.getElementById('script-stop').addEventListener('click', () => ctx.stopScript());
    document.getElementById('script-example').addEventListener('change', (e) => {
      const k = e.target.value;
      if (!k) return;
      const src = SCRIPT_EXAMPLES[k];
      if (!src) return;
      const area = document.getElementById('script-area');
      const dirty = area.value.trim() && area.value !== area.defaultValue;
      if (dirty && !confirm('Replace current script with this example?')) {
        e.target.value = '';
        return;
      }
      area.value = src;
      e.target.value = '';
    });

    document.getElementById('plot-clear').addEventListener('click', () => ctx.plot.clear());
    document.getElementById('plot-running').addEventListener('change', (e) => {
      ctx.plot.recording = e.target.checked;
    });

    document.getElementById('btn-new').addEventListener('click', () => {
      if (confirm('Start a new robot? Unsaved changes will be lost.')) {
        ctx.robot.clear();
        ctx.onSelect(null);
        ctx.refreshUI();
      }
    });
    document.getElementById('btn-save').addEventListener('click', () => ctx.saveJSON());
    document.getElementById('btn-load').addEventListener('click', () => ctx.loadFromFile('json'));
    document.getElementById('btn-export-urdf').addEventListener('click', () => ctx.exportURDF());
    document.getElementById('btn-import-urdf').addEventListener('click', () => ctx.loadFromFile('urdf'));
    if (this.elements.btnUploadJson) {
      this.elements.btnUploadJson.addEventListener('click', () => {
        ctx.loadFromFile('json', (info) => this.setDashboardStatus(`Loaded ${info.fileName}: ${info.joints} joints, ${info.endEffectors} end effectors`, false), (err) => this.setDashboardStatus(`Upload failed: ${err.message}`, true));
      });
    }

    const modal = document.getElementById('help-modal');
    document.getElementById('btn-help').addEventListener('click', () => modal.classList.remove('hidden'));
    document.getElementById('help-close').addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  }

  refreshAll() {
    this.refreshHierarchy();
    this.refreshSliders();
    this.refreshInspector();
    this.refreshEEList();
    this.refreshColorGrid();
    this.refreshBlocksList();
    this.refreshRobotsList();
    this.ctx.plot.setRobot(this.ctx.robot);
  }

  setDashboardStatus(message, isError = false) {
    if (!this.elements.robotDashboardStatus || !this.elements.robotDashboardSummary) return;
    this.elements.robotDashboardStatus.textContent = message;
    this.elements.robotDashboardStatus.style.color = isError ? 'var(--danger)' : 'var(--fg-dim)';
    if (!isError) {
      this.elements.robotDashboardSummary.textContent = 'Click Load JSON or Upload JSON again to replace the current robot.';
    }
  }

  refreshRobotsList() {
    const wrap = this.elements.robotsList;
    if (!wrap) return;
    const robots = this.ctx.robots || [];
    const activeIdx = this.ctx.activeRobotIdx ?? 0;
    wrap.innerHTML = '';
    robots.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'robot-card' + (i === activeIdx ? ' active' : '');
      const dof = r.joints?.length || 0;
      card.innerHTML = `
        <span class="rb-tag">${i === activeIdx ? '●' : '○'}</span>
        <span class="rb-name">Arm ${i + 1}</span>
        <span class="rb-dof">${dof} DoF</span>
        ${robots.length > 1 ? '<button class="x" title="Remove">×</button>' : ''}
      `;
      card.addEventListener('click', (e) => {
        if (e.target.matches('button.x')) return;
        if (i !== activeIdx) this.ctx.setActiveRobot?.(i);
      });
      const xBtn = card.querySelector('button.x');
      if (xBtn) xBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Remove arm ${i + 1}?`)) this.ctx.removeRobot?.(i);
      });
      wrap.appendChild(card);
    });
  }

  refreshBlocksList() {
    const wrap = this.elements.blocksList;
    if (!wrap) return;
    const bodies = this.ctx.physics?.bodies || [];
    wrap.innerHTML = '';
    if (bodies.length === 0) {
      wrap.innerHTML = '<em style="color:var(--fg-dim);font-size:11px;">No blocks. Click "+ Spawn block" or "Reset blocks".</em>';
      return;
    }
    bodies.forEach((body, idx) => {
      const row = document.createElement('div');
      row.className = 'block-row';
      const hex = '#' + body.mesh.material.color.getHex().toString(16).padStart(6, '0');
      const status = body.attachedTo ? 'held' : 'free';
      row.innerHTML = `
        <span class="sw" style="background:${hex}"></span>
        <span>Block ${idx + 1} <small style="color:var(--fg-dim)">(${status})</small></span>
        <input type="number" step="0.01" min="0" value="${(body.mass ?? 0.05).toFixed(2)}" title="mass (kg)"/>
        <button class="x" title="Delete">×</button>
      `;
      const inp = row.querySelector('input');
      inp.addEventListener('change', (e) => {
        body.mass = Math.max(0, parseFloat(e.target.value) || 0);
      });
      row.querySelector('button.x').addEventListener('click', () => {
        if (body.attachedTo) body.attachedTo.remove(body.mesh);
        else this.ctx.physics.scene.remove(body.mesh);
        body.mesh.geometry.dispose();
        body.mesh.material.dispose();
        const i = this.ctx.physics.bodies.indexOf(body);
        if (i >= 0) this.ctx.physics.bodies.splice(i, 1);
        this.refreshBlocksList();
      });
      wrap.appendChild(row);
    });
  }

  refreshTorques() {
    const wrap = this.elements.torqueReadout;
    if (!wrap) return;
    const rows = computeJointTorques(this.ctx.robot, this.ctx.physics);
    if (rows.length === 0) {
      wrap.innerHTML = '<em style="color:var(--fg-dim)">No joints.</em>';
      return;
    }
    const html = rows.map(r => {
      const isRev = r.type === 'revolute';
      const val = isRev ? `${r.torqueNm.toFixed(2)} N·m` : `${r.axialN.toFixed(2)} N`;
      const mag = Math.abs(isRev ? r.torqueNm : r.axialN);
      const cls = mag > 5 ? 'val hi' : 'val';
      return `<div class="torque-row"><span>${r.name}</span><span class="name">${isRev ? 'τ' : 'F'} (${r.axis.toUpperCase()})</span><span class="${cls}">${val}</span></div>`;
    }).join('');
    wrap.innerHTML = html;
  }

  refreshHierarchy() {
    const robot = this.ctx.robot;
    const root = this.elements.hierarchy;
    root.innerHTML = '';

    const baseEl = makeNode('• Base', 'link', 0);
    baseEl.classList.add('base');
    root.appendChild(baseEl);

    robot.joints.forEach((j, i) => {
      const indent = '  '.repeat(i + 1);
      const jEl = makeNode(`${indent}<span class="badge">${j.type === 'revolute' ? 'REV' : 'PRI'} ${j.axis.toUpperCase()}</span>${j.name}`, 'joint', i);
      jEl.dataset.idx = i;
      if (this.ctx.selected === i) jEl.classList.add('selected');
      jEl.addEventListener('click', () => this.ctx.onSelect(i));
      root.appendChild(jEl);

      const lEl = makeNode(`${indent}  <span class="badge">LINK</span>L${i + 1} (${j.link.length.toFixed(2)} m)`, 'link', i);
      lEl.addEventListener('click', () => this.ctx.onSelect(i));
      root.appendChild(lEl);
    });

    robot.endEffectors.forEach((ee, k) => {
      const tag = k === 0 ? 'EE' : 'AUX';
      const eEl = makeNode(`<span class="badge">${tag}</span>${EE_LABELS[ee.type] || ee.type}`, 'ee', -1);
      eEl.classList.add('ee');
      root.appendChild(eEl);
    });

    function makeNode(html, cls, idx) {
      const el = document.createElement('div');
      el.className = 'tree-node ' + cls;
      el.innerHTML = html;
      el.dataset.idx = idx;
      return el;
    }
  }

  refreshSliders() {
    const wrap = this.elements.jointSliders;
    wrap.innerHTML = '';
    const robot = this.ctx.robot;
    robot.joints.forEach((j, i) => {
      const row = document.createElement('div');
      row.className = 'joint-row';
      const unit = j.type === 'revolute' ? 'rad' : 'm';
      row.innerHTML = `
        <div class="head">
          <span>${j.name} (${j.type === 'revolute' ? 'REV' : 'PRI'} ${j.axis.toUpperCase()})</span>
          <span class="val" id="jv-${i}">${j.value.toFixed(3)} ${unit}</span>
        </div>
        <input type="range" min="${j.min}" max="${j.max}" step="0.001" value="${j.value}" />
        <div class="vals">
          <input type="number" class="val-num" step="0.01" value="${j.value.toFixed(3)}" />
          <input type="number" class="val-min" step="0.05" value="${j.min.toFixed(2)}" title="min" />
          <input type="number" class="val-max" step="0.05" value="${j.max.toFixed(2)}" title="max" />
        </div>
      `;
      const slider = row.querySelector('input[type=range]');
      const num = row.querySelector('.val-num');
      const mn = row.querySelector('.val-min');
      const mx = row.querySelector('.val-max');

      const updateValDisplay = () => {
        document.getElementById(`jv-${i}`).textContent = j.value.toFixed(3) + ' ' + unit;
      };

      slider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        robot.setJointValue(i, v);
        num.value = v.toFixed(3);
        updateValDisplay();
      });
      num.addEventListener('change', (e) => {
        const v = parseFloat(e.target.value);
        robot.setJointValue(i, v);
        slider.value = j.value;
        updateValDisplay();
      });
      mn.addEventListener('change', (e) => {
        j.min = parseFloat(e.target.value);
        slider.min = j.min;
      });
      mx.addEventListener('change', (e) => {
        j.max = parseFloat(e.target.value);
        slider.max = j.max;
      });

      wrap.appendChild(row);
    });
  }

  refreshInspector() {
    const i = this.ctx.selected;
    const robot = this.ctx.robot;
    const insp = this.elements.inspector;
    if (i == null || !robot.joints[i]) {
      insp.innerHTML = '<em>No joint selected</em>';
      this.elements.selName.textContent = 'none';
      return;
    }
    const j = robot.joints[i];
    this.elements.selName.textContent = j.name;
    const linkColorHex = '#' + (j.link.color ?? robot.colors.link).toString(16).padStart(6, '0');
    const linkColorOverridden = j.link.color != null;
    insp.innerHTML = `
      <div class="field"><label>Name</label><input type="text" id="i-name" value="${escapeHtml(j.name)}" style="width:100px"/></div>
      <div class="field"><label>Type</label>
        <select id="i-type">
          <option value="revolute" ${j.type === 'revolute' ? 'selected' : ''}>Revolute</option>
          <option value="prismatic" ${j.type === 'prismatic' ? 'selected' : ''}>Prismatic</option>
        </select>
      </div>
      <div class="field"><label>Axis</label>
        <select id="i-axis">
          <option value="x" ${j.axis === 'x' ? 'selected' : ''}>X</option>
          <option value="y" ${j.axis === 'y' ? 'selected' : ''}>Y</option>
          <option value="z" ${j.axis === 'z' ? 'selected' : ''}>Z</option>
        </select>
      </div>
      <div class="field"><label>Link length (m)</label><input type="number" step="0.05" id="i-len" value="${j.link.length.toFixed(3)}"/></div>
      <div class="field"><label>Link radius (m)</label><input type="number" step="0.005" id="i-rad" value="${j.link.radius.toFixed(3)}"/></div>
      <div class="field"><label>Link extends</label>
        <select id="i-link-axis">
          <option value="+y" ${(j.link.axis||'+y') === '+y' ? 'selected' : ''}>+Y (up)</option>
          <option value="-y" ${j.link.axis === '-y' ? 'selected' : ''}>−Y (down)</option>
          <option value="+x" ${j.link.axis === '+x' ? 'selected' : ''}>+X</option>
          <option value="-x" ${j.link.axis === '-x' ? 'selected' : ''}>−X</option>
          <option value="+z" ${j.link.axis === '+z' ? 'selected' : ''}>+Z</option>
          <option value="-z" ${j.link.axis === '-z' ? 'selected' : ''}>−Z</option>
        </select>
      </div>
      <div class="field"><label>Link color</label>
        <span style="display:inline-flex;gap:4px;align-items:center;">
          <input type="color" id="i-link-color" value="${linkColorHex}"/>
          <button id="i-link-color-clear" title="Use global link color">${linkColorOverridden ? 'reset' : '—'}</button>
        </span>
      </div>
      <div class="field"><label>Min</label><input type="number" step="0.05" id="i-min" value="${j.min.toFixed(3)}"/></div>
      <div class="field"><label>Max</label><input type="number" step="0.05" id="i-max" value="${j.max.toFixed(3)}"/></div>
      <div class="field"><label>Value</label><input type="number" step="0.01" id="i-val" value="${j.value.toFixed(3)}"/></div>
      <div class="field"><button id="i-delete" class="danger">Delete (and chain after)</button></div>
    `;

    insp.querySelector('#i-name').addEventListener('change', (e) => { j.name = e.target.value; this.refreshHierarchy(); this.refreshSliders(); });
    insp.querySelector('#i-type').addEventListener('change', (e) => { j.type = e.target.value; robot.rebuildJointGeometry(j); this.refreshHierarchy(); this.refreshSliders(); });
    insp.querySelector('#i-axis').addEventListener('change', (e) => { j.axis = e.target.value; robot.rebuildJointGeometry(j); this.refreshHierarchy(); });
    insp.querySelector('#i-len').addEventListener('change', (e) => { j.link.length = parseFloat(e.target.value); robot.rebuildJointGeometry(j); this.refreshHierarchy(); });
    insp.querySelector('#i-rad').addEventListener('change', (e) => { j.link.radius = parseFloat(e.target.value); robot.rebuildJointGeometry(j); });
    insp.querySelector('#i-link-axis').addEventListener('change', (e) => { j.link.axis = e.target.value; robot.rebuildJointGeometry(j); this.refreshHierarchy(); });
    insp.querySelector('#i-link-color').addEventListener('input', (e) => {
      j.link.color = parseInt(e.target.value.slice(1), 16);
      robot.rebuildJointGeometry(j);
    });
    insp.querySelector('#i-link-color-clear').addEventListener('click', () => {
      j.link.color = null;
      robot.rebuildJointGeometry(j);
      this.refreshInspector();
    });
    insp.querySelector('#i-min').addEventListener('change', (e) => { j.min = parseFloat(e.target.value); this.refreshSliders(); });
    insp.querySelector('#i-max').addEventListener('change', (e) => { j.max = parseFloat(e.target.value); this.refreshSliders(); });
    insp.querySelector('#i-val').addEventListener('change', (e) => { robot.setJointValue(i, parseFloat(e.target.value)); this.refreshSliders(); });
    insp.querySelector('#i-delete').addEventListener('click', () => {
      robot.removeJoint(j.id);
      this.ctx.onSelect(null);
      this.refreshAll();
    });
  }

  refreshEEList() {
    const robot = this.ctx.robot;
    const wrap = this.elements.eeList;
    wrap.innerHTML = '';
    if (robot.endEffectors.length === 0) {
      wrap.innerHTML = '<em style="color:var(--fg-dim);font-size:11px;">No tools mounted.</em>';
      return;
    }

    robot.endEffectors.forEach((ee, idx) => {
      const card = document.createElement('div');
      card.className = 'ee-card';
      const isPrimary = idx === 0;
      const label = EE_LABELS[ee.type] || ee.type;
      card.innerHTML = `
        <div class="ee-head">
          <span class="ee-title">${isPrimary ? '<span class="pri-badge">PRIMARY</span>' : '<span class="pri-badge" style="background:#3a2c1c;color:#ffd5a8;">AUX</span>'} ${label}</span>
          <button class="x" data-idx="${idx}">remove</button>
        </div>
        <div class="ee-body" data-body></div>
      `;
      const body = card.querySelector('[data-body]');
      this._renderEEControls(ee, body);
      card.querySelector('button.x').addEventListener('click', () => {
        robot.removeEndEffector(idx);
        this.refreshEEList();
        this.refreshHierarchy();
      });
      wrap.appendChild(card);
    });
  }

  _renderEEControls(ee, wrap) {
    const physics = this.ctx.physics;
    if (ee.type === 'gripper' || ee.type === 'gripper3') {
      wrap.innerHTML = `<label>Open <input type="range" min="0" max="1" step="0.01" value="${ee.params.open}"/> <span class="ov">${ee.params.open.toFixed(2)}</span></label>`;
      const r = wrap.querySelector('input');
      const ov = wrap.querySelector('.ov');
      r.addEventListener('input', (e) => { ee.setParam('open', e.target.value); ov.textContent = (+e.target.value).toFixed(2); });
    } else if (ee.type === 'suction') {
      wrap.innerHTML = `<label><input type="checkbox" data-suct ${ee.params.suction ? 'checked' : ''}/> Suction on</label>`;
      wrap.querySelector('[data-suct]').addEventListener('change', (e) => {
        ee.setParam('suction', e.target.checked);
        if (e.target.checked) physics.tryGrab(ee.tip);
        else physics.release(ee.tip);
      });
    } else if (ee.type === 'welder') {
      wrap.innerHTML = `<label><input type="checkbox" data-w ${ee.params.welding ? 'checked' : ''}/> Welding on</label>`;
      wrap.querySelector('[data-w]').addEventListener('change', (e) => ee.setParam('welding', e.target.checked));
    } else if (ee.type === 'camera') {
      wrap.innerHTML = `<label><input type="checkbox" data-f ${ee.params.showFrustum ? 'checked' : ''}/> Show sensor frustum</label>
        <label><input type="checkbox" data-detect ${ee.params.detect ? 'checked' : ''}/> Highlight detected blocks</label>
        <div class="row" style="gap:4px;flex-wrap:wrap;">
          <button data-scan>Scan now</button>
          <button data-grab-orange title="Sweep, find an orange block, and pick it up">Find &amp; grab orange</button>
          <button data-stop-task title="Cancel the running camera task">Stop</button>
        </div>
        <div class="ee-detect-info" style="font-size:11px;color:var(--fg-dim);margin-top:4px;">No scan yet.</div>`;
      const info = wrap.querySelector('.ee-detect-info');
      const runScan = () => {
        const hits = physics.scanBlocks(ee.tip, { fov: Math.PI / 3, range: 2.5 });

        for (const b of physics.bodies) physics.setBlockHighlight(b, false);
        if (ee.params.detect) for (const h of hits) physics.setBlockHighlight(h.body, true);
        info.textContent = hits.length === 0
          ? 'No blocks visible.'
          : `${hits.length} visible — closest ${hits[0].distance.toFixed(2)} m`;
        return hits;
      };
      wrap.querySelector('[data-f]').addEventListener('change', (e) => ee.setParam('showFrustum', e.target.checked));
      wrap.querySelector('[data-detect]').addEventListener('change', (e) => {
        ee.params.detect = !!e.target.checked;
        if (!ee.params.detect) for (const b of physics.bodies) physics.setBlockHighlight(b, false);
        else runScan();
      });
      wrap.querySelector('[data-scan]').addEventListener('click', runScan);
      wrap.querySelector('[data-grab-orange]').addEventListener('click', () => {
        this.ctx.runScriptText(SCRIPT_EXAMPLES.grabOrange);
      });
      wrap.querySelector('[data-stop-task]').addEventListener('click', () => {
        this.ctx.stopScript();
      });

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
      wrap.innerHTML = `<label><input type="checkbox" data-s ${ee.params.spinning ? 'checked' : ''}/> Spinning</label>
        <label>RPM <input type="number" data-rpm step="50" value="${ee.params.rpm}" style="width:70px"/></label>`;
      wrap.querySelector('[data-s]').addEventListener('change', (e) => ee.setParam('spinning', e.target.checked));
      wrap.querySelector('[data-rpm]').addEventListener('change', (e) => ee.setParam('rpm', e.target.value));
    } else if (ee.type === 'magnet') {
      wrap.innerHTML = `<label><input type="checkbox" data-e ${ee.params.energized ? 'checked' : ''}/> Energized</label>`;
      wrap.querySelector('[data-e]').addEventListener('change', (e) => {
        ee.setParam('energized', e.target.checked);
        if (e.target.checked) physics.tryGrab(ee.tip);
        else physics.release(ee.tip);
      });
    } else if (ee.type === 'laser') {
      wrap.innerHTML = `<label><input type="checkbox" data-fire ${ee.params.firing ? 'checked' : ''}/> Firing</label>`;
      wrap.querySelector('[data-fire]').addEventListener('change', (e) => ee.setParam('firing', e.target.checked));
    } else if (ee.type === 'paint') {
      const colorHex = '#' + (ee.params.color || 0xffffff).toString(16).padStart(6, '0');
      wrap.innerHTML = `<label><input type="checkbox" data-spray ${ee.params.spraying ? 'checked' : ''}/> Spraying</label>
        <label>Color <input type="color" data-color value="${colorHex}"/></label>`;
      wrap.querySelector('[data-spray]').addEventListener('change', (e) => ee.setParam('spraying', e.target.checked));
      wrap.querySelector('[data-color]').addEventListener('input', (e) => ee.setParam('color', parseInt(e.target.value.slice(1), 16)));
    }

    if (ee.tip) {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.marginTop = '4px';
      row.innerHTML = `<button data-univ-grab>Grab nearest</button>
        <button data-univ-release>Drop</button>`;
      row.querySelector('[data-univ-grab]').addEventListener('click', () => physics.tryGrab(ee.tip));
      row.querySelector('[data-univ-release]').addEventListener('click', () => physics.release(ee.tip));
      wrap.appendChild(row);
    }
  }

  tickReadouts(eeWorld, simTime) {
    this.elements.eePos.textContent = `(${eeWorld.x.toFixed(2)}, ${eeWorld.y.toFixed(2)}, ${eeWorld.z.toFixed(2)})`;
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
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}
