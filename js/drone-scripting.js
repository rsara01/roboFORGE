

import * as THREE from 'three';

const SCRIPT_CANCELLED = Symbol('SCRIPT_CANCELLED');

const EXAMPLES = {
  square: `async function run() {
  setMode("HOVER");
  const alt = 5;
  const path = [
    [ 6, alt,  0],
    [ 6, alt,  6],
    [ 0, alt,  6],
    [ 0, alt,  0],
  ];
  for (const [x, y, z] of path) {
    log("flying to " + x + "," + z);
    await flyTo(x, y, z, { tolerance: 0.6, timeout: 12 });
    await wait(0.5);
  }
  log("done");
}
run();`,

  climb: `async function run() {
  setMode("HOVER");
  await flyTo(0, 20, 0, { tolerance: 0.5, timeout: 15 });
  log("at altitude, starting spiral");
  const turns = 3, steps = 48, r = 8;
  for (let i = 0; i <= turns * steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    setTarget({ x: Math.cos(a) * r, y: 20, z: Math.sin(a) * r });
    await wait(0.15);
  }
  await flyTo(0, 5, 0, { tolerance: 0.5, timeout: 15 });
  log("home");
}
run();`,

  mission: `clearWaypoints();
addWaypoint( 6, 6,  0);
addWaypoint( 6, 8,  6);
addWaypoint(-4, 4, -4);
log("mission armed, " + 3 + " waypoints");
runMission();`,

  windy: `async function run() {
  setMode("HOVER");
  await flyTo(0, 8, 0, { tolerance: 0.4, timeout: 10 });
  for (let i = 0; i < 8; i++) {
    const wx = (Math.random() * 12) - 6;
    const wz = (Math.random() * 12) - 6;
    log("wind " + wx.toFixed(1) + ", " + wz.toFixed(1));
    setWind(wx, wz);
    await wait(2.0);
  }
  setWind(0, 0);
  log("calm");
}
run();`,
};

export class DroneScriptRunner {
  constructor(api, output) {
    this.api = api;
    this.output = output;
    this.cancelToken = { cancelled: false };
  }
  log(msg) {
    if (!this.output) return;
    const line = (typeof msg === 'string' ? msg : JSON.stringify(msg));
    this.output.textContent += line + '\n';
    this.output.scrollTop = this.output.scrollHeight;
  }
  clearOutput() { if (this.output) this.output.textContent = ''; }
  stop() { this.cancelToken.cancelled = true; }

  async run(source) {
    this.cancelToken = { cancelled: false };
    const token = this.cancelToken;
    const ckc = () => { if (token.cancelled) throw SCRIPT_CANCELLED; };

    const wait = (s) => new Promise((resolve, reject) => {
      const ms = Math.max(0, s * 1000);
      const start = performance.now();
      const tick = () => {
        if (token.cancelled) return reject(SCRIPT_CANCELLED);
        if (performance.now() - start >= ms) return resolve();
        requestAnimationFrame(tick);
      };
      tick();
    });

    const log = (m) => this.log(m);
    const a = this.api;

    const flyTo = async (x, y, z, opts = {}) => {
      const tol = opts.tolerance ?? 0.5;
      const timeout = opts.timeout ?? 15;
      a.setTarget({ x, y, z });
      const t0 = performance.now();
      while (true) {
        ckc();
        const p = a.position();
        const d = Math.hypot(p.x - x, p.y - y, p.z - z);
        if (d <= tol) return;
        if ((performance.now() - t0) / 1000 > timeout) {
          log('flyTo: timeout at distance ' + d.toFixed(2));
          return;
        }
        await wait(0.05);
      }
    };

    const env = {
      setTarget: a.setTarget,
      flyTo,
      wait,
      position: a.position,
      velocity: a.velocity,
      yaw: a.yaw,
      setMode: a.setMode,
      setWind: a.setWind,
      gust: a.gust,
      setGravity: a.setGravity,
      setDrag: a.setDrag,
      addWaypoint: a.addWaypoint,
      clearWaypoints: a.clearWaypoints,
      runMission: a.runMission,
      reset: a.reset,
      log,
      THREE,
    };

    const argNames = Object.keys(env);
    const argValues = argNames.map(k => env[k]);

    try {
      const fn = new Function(...argNames, '"use strict";\nreturn (async () => {\n' + source + '\n})();');
      await fn(...argValues);
      this.log('[script] finished');
    } catch (err) {
      if (err === SCRIPT_CANCELLED) {
        this.log('[script] cancelled');
      } else {
        this.log('[script error] ' + (err && err.message ? err.message : err));
        console.error(err);
      }
    }
  }
}

export const DRONE_SCRIPT_EXAMPLES = EXAMPLES;
