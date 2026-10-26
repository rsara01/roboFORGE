/**
 * 2D IK explainer: a three-joint arm solved with CCD, one joint per step, so
 * you can watch it think. Each step leaves a fading "ghost" of the previous
 * pose (onion-skinning). Drag the orange target, or use the arrow keys.
 */

const GHOSTS = 9;            // how many earlier guesses to keep on screen
const DONE_PX = 1.2;         // close enough, in CSS pixels
const ARM_CM = 60;           // pretend the arm is 60 cm long, for the readout
const MAX_PASSES = 40;       // CCD crawls near full stretch; stop and say how close it got

/**
 * @param {{canvas: HTMLCanvasElement, speed: HTMLInputElement, step: HTMLButtonElement,
 *          status: HTMLElement, reduceMotion: MediaQueryList}} opts
 */
export function mountIKToy({ canvas, speed, step, status, reduceMotion }) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let base, lens;

  const angles = [-1.25, 0.95, 0.75];     // relative joint angles (radians)
  const target = { x: 0, y: 0 };
  let ghosts = [];                        // earlier poses, oldest first
  let jointIdx = angles.length - 1;       // the joint CCD turns next
  let lastMoved = -1;                     // the joint it just turned
  let pass = 1, steps = 0;
  let solved = false;
  let dragging = false;
  let colors = readColors();

  function readColors() {
    const s = getComputedStyle(document.documentElement);
    const v = (n, d) => s.getPropertyValue(n).trim() || d;
    return { ink: v('--ink', '#1b1b1d'), ink3: v('--ink-3', '#6b6c71'), line: v('--line', '#e2e0db'),
             surface: v('--surface', '#fff'), accent: v('--accent', '#f08327') };
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { colors = readColors(); draw(); });

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const oldW = W || r.width, oldH = H || r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    base = { x: W * 0.24, y: H * 0.84 };
    lens = [0.27, 0.21, 0.15].map(f => f * W);
    if (!target.x) { target.x = W * 0.74; target.y = H * 0.4; }
    else { target.x *= W / oldW; target.y *= H / oldH; }
    draw();
  }

  /** Joint positions (base, j2, j3, tip) for a set of angles. */
  function fk(a = angles) {
    const pts = [{ ...base }];
    let th = 0, x = base.x, y = base.y;
    for (let i = 0; i < a.length; i++) {
      th += a[i];
      x += lens[i] * Math.cos(th); y += lens[i] * Math.sin(th);
      pts.push({ x, y });
    }
    return pts;
  }
  const tip = () => fk().at(-1);
  const err = () => { const t = tip(); return Math.hypot(t.x - target.x, t.y - target.y); };

  /** One CCD step: turn joint `jointIdx` so the tip points at the target. */
  function ccdStep() {
    if (solved) return;
    ghosts.push(angles.slice());
    if (ghosts.length > GHOSTS) ghosts.shift();
    const pts = fk();
    const p = pts[jointIdx], t = pts.at(-1);
    const delta = Math.atan2(target.y - p.y, target.x - p.x) - Math.atan2(t.y - p.y, t.x - p.x);
    angles[jointIdx] += Math.atan2(Math.sin(delta), Math.cos(delta));   // wrap to [-π, π]
    lastMoved = jointIdx;
    steps++;
    jointIdx--;
    if (jointIdx < 0) { jointIdx = angles.length - 1; pass++; }
    if (err() < DONE_PX || pass > MAX_PASSES) solved = true;
  }

  function targetMoved() {
    solved = false; pass = 1; steps = 0; jointIdx = angles.length - 1;
    if (reduceMotion.matches) {
      // No animation: solve straight away and show the guesses as a still picture.
      ghosts = [];
      for (let i = 0; i < 90 && !solved; i++) ccdStep();
      draw();
    }
  }

  function writeStatus() {
    const cm = err() * ARM_CM / lens.reduce((a, b) => a + b, 0);
    status.textContent = !solved
      ? `pass ${pass} · joint ${jointIdx + 1} next · ${cm.toFixed(1)} cm away`
      : err() < DONE_PX
        ? `got there in ${steps} step${steps === 1 ? '' : 's'}`
        : `stuck ${cm.toFixed(1)} cm short (that's as far as it reaches)`;
  }

  function line(pts, width, color, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function dot(p, r, fill, stroke, w = 2) {
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = w; ctx.stroke(); }
  }

  function draw() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.surface; ctx.fillRect(0, 0, W, H);

    // floor + base
    line([{ x: 0, y: base.y + 14 }, { x: W, y: base.y + 14 }], 1, colors.line);
    ctx.fillStyle = colors.ink;
    ctx.fillRect(base.x - 22, base.y + 2, 44, 12);

    // ghosts: oldest faintest
    ghosts.forEach((g, i) => line(fk(g), 2, colors.ink3, 0.08 + 0.32 * (i + 1) / ghosts.length));

    const pts = fk();
    // the angle CCD is about to fix: joint → tip and joint → target
    if (!solved) {
      const p = pts[jointIdx];
      ctx.setLineDash([4, 6]);
      line([pts.at(-1), p, target], 1.5, colors.ink3, 0.8);
      ctx.setLineDash([]);
    }
    line(pts, 7, colors.ink);
    for (let i = 0; i < pts.length - 1; i++) dot(pts[i], 7.5, colors.surface, colors.ink, 2.5);
    if (lastMoved >= 0 && !solved) dot(pts[lastMoved], 12, null, colors.accent, 2.5);
    dot(pts.at(-1), 4, colors.ink);

    // target (live, so it's orange)
    dot(target, dragging ? 13 : 10, colors.accent, colors.ink, 2);
    writeStatus();
  }

  // ---- timing: the speed slider sets how long each joint step takes
  let acc = 0, last = performance.now(), onScreen = true;
  function interval() {
    const s = +speed.value;
    if (s < 0.02) return Infinity;                      // far left = paused
    return 700 * Math.pow(25 / 700, Math.pow(s, 0.7));   // 700 ms → 25 ms
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = now - last; last = now;
    if (!onScreen || document.hidden || reduceMotion.matches) return;
    if (solved) { if (ghosts.length) { ghosts.shift(); draw(); } return; }
    acc += dt;
    const iv = interval();
    let n = 0;
    while (acc >= iv && n < 8 && !solved) { ccdStep(); acc -= iv; n++; }
    if (iv === Infinity) acc = 0;
    if (n) draw();
  }
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }, { threshold: 0.05 }).observe(canvas);

  // ---- input
  function toLocal(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function moveTarget(x, y) {
    target.x = Math.min(W - 8, Math.max(8, x));
    target.y = Math.min(base.y + 6, Math.max(8, y));
    targetMoved();
    draw();
  }
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    const p = toLocal(e); moveTarget(p.x, p.y);
  });
  canvas.addEventListener('pointermove', (e) => { if (dragging) { const p = toLocal(e); moveTarget(p.x, p.y); } });
  const stop = () => { dragging = false; draw(); };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 36 : 12;
    const m = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (!m) return;
    e.preventDefault();
    moveTarget(target.x + m[0], target.y + m[1]);
  });
  step.addEventListener('click', () => {
    speed.value = '0';                 // stepping by hand pauses the auto-solver
    if (solved) { solved = false; }
    ccdStep(); draw();
  });
  speed.addEventListener('input', () => { if (reduceMotion.matches) return; acc = 0; });

  new ResizeObserver(resize).observe(canvas);
  resize();
  if (reduceMotion.matches) targetMoved();
  requestAnimationFrame(frame);
}
