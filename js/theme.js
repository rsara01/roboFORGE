

const KEY = 'roboforge.theme';

const DEFAULT = {
  accent: '#667eea',
  accent2: '#764ba2',
};

function hexToRgb(hex) {
  const m = hex.replace('#', '');
  const v = m.length === 3
    ? m.split('').map(c => c + c).join('')
    : m;
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const f = (c) => {
    const v = amount > 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}

export const Theme = {
  load() {
    try { return Object.assign({}, DEFAULT, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch { return { ...DEFAULT }; }
  },
  save(t) {
    localStorage.setItem(KEY, JSON.stringify(t));
  },
  apply(t = this.load()) {
    const root = document.documentElement;
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent-2', t.accent2);
    root.style.setProperty('--accent-soft', shade(t.accent, 0.5));
    root.style.setProperty('--accent-deep', shade(t.accent, -0.3));
    root.style.setProperty('--brand-grad', `linear-gradient(135deg, ${t.accent} 0%, ${t.accent2} 100%)`);
  },
  set(partial) {
    const next = { ...this.load(), ...partial };
    this.save(next);
    this.apply(next);
    return next;
  },
  reset() {
    localStorage.removeItem(KEY);
    this.apply(DEFAULT);
    return { ...DEFAULT };
  },
};

Theme.apply();
