// Lightweight WebAudio sound engine: synthesizes effects on the fly so we
// don't ship audio assets. Voices are short bursts (clicks, hums, thuds);
// the longer ones (motor hum, conveyor) are continuous oscillators whose
// gain we ramp with intensity.

const ctxRef = { ctx: null, master: null };

function ensureCtx() {
  if (ctxRef.ctx) return ctxRef.ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  const master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);
  ctxRef.ctx = ctx;
  ctxRef.master = master;
  // Browsers gate audio until user interaction. Resume on the next gesture.
  const resume = () => {
    if (ctx.state === 'suspended') ctx.resume();
    window.removeEventListener('pointerdown', resume);
    window.removeEventListener('keydown', resume);
  };
  window.addEventListener('pointerdown', resume, { once: true });
  window.addEventListener('keydown', resume, { once: true });
  return ctx;
}

export const Sound = {
  enabled: true,
  setEnabled(v) { this.enabled = !!v; },
  setVolume(v) {
    ensureCtx();
    if (ctxRef.master) ctxRef.master.gain.value = Math.max(0, Math.min(1, v));
  },

  // ---- one-shots ---------------------------------------------------------
  click() { this._burst({ freq: 880, dur: 0.04, gain: 0.18, type: 'square' }); },
  ok()    { this._burst({ freq: 660, dur: 0.10, gain: 0.20, type: 'sine'   }); },
  err()   { this._burst({ freq: 180, dur: 0.18, gain: 0.30, type: 'sawtooth' }); },
  grab()  { this._burst({ freq: 520, dur: 0.06, gain: 0.30, type: 'square' });
            setTimeout(() => this._burst({ freq: 320, dur: 0.06, gain: 0.22, type: 'square' }), 50); },
  release() { this._burst({ freq: 320, dur: 0.06, gain: 0.22, type: 'square' }); },
  thud()  { this._noise({ dur: 0.20, gain: 0.40, lp: 240, attack: 0.005 }); },
  shot()  { this._noise({ dur: 0.10, gain: 0.55, lp: 4000, attack: 0.001 });
            this._burst({ freq: 110, dur: 0.06, gain: 0.40, type: 'square' }); },
  boom()  { this._noise({ dur: 0.7, gain: 0.55, lp: 700, attack: 0.005 }); },
  beep()  { this._burst({ freq: 1320, dur: 0.06, gain: 0.20, type: 'sine' }); },

  // ---- continuous (call setIntensity(0..1) to fade in/out) --------------
  motor(name, baseFreq = 90) {
    const ctx = ensureCtx();
    if (!ctx) return { setIntensity() {}, stop() {} };
    if (this._loops?.[name]) return this._loops[name];
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth'; osc1.frequency.value = baseFreq;
    osc2.type = 'square';   osc2.frequency.value = baseFreq * 1.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 800;
    const g = ctx.createGain(); g.gain.value = 0;
    osc1.connect(lp); osc2.connect(lp); lp.connect(g); g.connect(ctxRef.master);
    osc1.start(); osc2.start();
    const handle = {
      setIntensity(v) {
        if (!Sound.enabled) v = 0;
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.linearRampToValueAtTime(0.18 * Math.max(0, Math.min(1, v)), t + 0.05);
        const f = baseFreq * (0.6 + v * 1.2);
        osc1.frequency.linearRampToValueAtTime(f, t + 0.05);
        osc2.frequency.linearRampToValueAtTime(f * 1.5, t + 0.05);
      },
      stop() {
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.linearRampToValueAtTime(0, t + 0.05);
        setTimeout(() => { try { osc1.stop(); osc2.stop(); } catch {} }, 80);
        delete Sound._loops[name];
      },
    };
    this._loops = this._loops || {};
    this._loops[name] = handle;
    return handle;
  },

  // ---- internals --------------------------------------------------------
  _burst({ freq, dur, gain, type = 'sine' }) {
    if (!this.enabled) return;
    const ctx = ensureCtx(); if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.value = 0;
    osc.connect(g); g.connect(ctxRef.master);
    const t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t); osc.stop(t + dur + 0.02);
  },
  _noise({ dur, gain, lp = 4000, attack = 0.005 }) {
    if (!this.enabled) return;
    const ctx = ensureCtx(); if (!ctx) return;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = lp;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(filter); filter.connect(g); g.connect(ctxRef.master);
    const t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.start(t); src.stop(t + dur + 0.02);
  },
};

window.Sound = Sound;
