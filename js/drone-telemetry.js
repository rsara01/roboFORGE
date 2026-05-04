// Multi-channel rolling-window scope plot for drone telemetry.
// Each call to push(t, channels[]) appends one sample; render() draws the
// last `windowSec` seconds across the canvas. Auto-scales Y to data range.

const COLORS = ['#4ea1ff', '#ffae42', '#66bb6a', '#ef5350', '#ab47bc', '#26c6da'];

export class TelemetryPlot {
  constructor(canvas, channels, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.channels = channels;             // [{name, color?}]
    this.windowSec = opts.windowSec ?? 12;
    this.history = [];
    this.yMin = opts.yMin;                // optional fixed range
    this.yMax = opts.yMax;
    this._fit();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this._fit()).observe(canvas);
    }
  }

  _fit() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(50, Math.round(r.width * dpr));
    const h = Math.max(50, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  push(t, values) {
    this.history.push({ t, v: values.slice() });
    const cutoff = t - this.windowSec;
    while (this.history.length && this.history[0].t < cutoff) this.history.shift();
  }

  clear() { this.history.length = 0; }

  render() {
    this._fit();
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = window.devicePixelRatio || 1;

    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, w, h);

    // Gridlines.
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

    let minV = this.yMin ?? Infinity;
    let maxV = this.yMax ?? -Infinity;
    if (this.yMin === undefined || this.yMax === undefined) {
      for (const s of this.history) {
        for (const v of s.v) {
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
      }
      if (!isFinite(minV)) { minV = -1; maxV = 1; }
      if (maxV - minV < 0.01) { maxV = minV + 1; }
      const pad = (maxV - minV) * 0.1;
      minV -= pad; maxV += pad;
    }

    for (let j = 0; j < this.channels.length; j++) {
      const color = this.channels[j].color || COLORS[j % COLORS.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4 * dpr;
      ctx.beginPath();
      let started = false;
      for (const s of this.history) {
        if (j >= s.v.length) continue;
        const x = ((s.t - tStart) / this.windowSec) * w;
        const y = h - ((s.v[j] - minV) / (maxV - minV)) * h;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Axis labels.
    ctx.fillStyle = '#5b6b7d';
    ctx.font = `${10 * dpr}px monospace`;
    ctx.fillText(maxV.toFixed(2), 4 * dpr, 12 * dpr);
    ctx.fillText(minV.toFixed(2), 4 * dpr, h - 4 * dpr);

    // Legend (top-right).
    let lx = w - 4 * dpr;
    for (let j = this.channels.length - 1; j >= 0; j--) {
      const label = this.channels[j].name;
      const color = this.channels[j].color || COLORS[j % COLORS.length];
      const tw = ctx.measureText(label).width;
      lx -= tw + 14 * dpr;
      ctx.fillStyle = color;
      ctx.fillRect(lx, 4 * dpr, 8 * dpr, 8 * dpr);
      ctx.fillStyle = '#9aa7b4';
      ctx.fillText(label, lx + 12 * dpr, 12 * dpr);
      lx -= 4 * dpr;
    }
  }
}
