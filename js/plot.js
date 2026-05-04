

const COLORS = ['#4ea1ff', '#ffae42', '#66bb6a', '#ef5350', '#ab47bc', '#26c6da'];

export class JointPlot {
  constructor(canvas, legendEl) {
    this.canvas = canvas;
    this.legend = legendEl;
    this.ctx = canvas.getContext('2d');
    this.windowSec = 20;
    this.history = [];
    this.recording = true;
    this.numJoints = 0;

this._fit();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this._fit()).observe(canvas);
    }
  }

  _fit() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(r.width * dpr) ||
        this.canvas.height !== Math.round(r.height * dpr)) {
      this.canvas.width = Math.max(50, Math.round(r.width * dpr));
      this.canvas.height = Math.max(50, Math.round(r.height * dpr));
    }
  }

  setRobot(robot) {
    this.numJoints = robot.joints.length;
    this._renderLegend(robot);
  }

  _renderLegend(robot) {
    if (!this.legend) return;
    this.legend.innerHTML = '';
    for (let i = 0; i < (robot?.joints?.length || 0); i++) {
      const el = document.createElement('span');
      el.className = 'leg';
      el.innerHTML = `<span class="sw" style="background:${COLORS[i % COLORS.length]}"></span> ${robot.joints[i].name}`;
      this.legend.appendChild(el);
    }
  }

  push(t, jointValues) {
    if (!this.recording) return;
    this.history.push({ t, q: jointValues.slice() });
    const cutoff = t - this.windowSec;
    while (this.history.length && this.history[0].t < cutoff) this.history.shift();
  }

  clear() { this.history.length = 0; }

  render() {
    this._fit();
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, w, h);

ctx.strokeStyle = '#1f2a3a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const y = (h * i) / 4;
      ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    ctx.stroke();

    if (this.history.length < 2) return;

    const tEnd = this.history[this.history.length - 1].t;
    const tStart = tEnd - this.windowSec;

let minV = -1, maxV = 1;
    for (const s of this.history) {
      for (const v of s.q) {
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
    if (maxV - minV < 0.001) { maxV = minV + 1; }
    const pad = (maxV - minV) * 0.1;
    minV -= pad; maxV += pad;

    const numJ = this.numJoints || (this.history[0].q.length);
    for (let j = 0; j < numJ; j++) {
      ctx.strokeStyle = COLORS[j % COLORS.length];
      ctx.lineWidth = 1.4 * (window.devicePixelRatio || 1);
      ctx.beginPath();
      let started = false;
      for (const s of this.history) {
        const x = ((s.t - tStart) / this.windowSec) * w;
        const y = h - ((s.q[j] - minV) / (maxV - minV)) * h;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = '#5b6b7d';
    ctx.font = `${10 * dpr}px monospace`;
    ctx.fillText(maxV.toFixed(2), 4 * dpr, 12 * dpr);
    ctx.fillText(minV.toFixed(2), 4 * dpr, h - 4 * dpr);
  }
}
