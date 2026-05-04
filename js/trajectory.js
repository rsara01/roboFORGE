

export class Trajectory {
  constructor(waypoints = [], options = {}) {
    this.waypoints = waypoints.slice().sort((a, b) => a.t - b.t);
    this.maxVelocity = options.maxVelocity ?? null;
    this.maxAcceleration = options.maxAcceleration ?? null;
    this.kind = options.kind ?? 'quintic';
  }

  duration() {
    return this.waypoints.length ? this.waypoints[this.waypoints.length - 1].t : 0;
  }

sample(t) {
    if (this.waypoints.length === 0) return [];
    if (t <= this.waypoints[0].t) return this.waypoints[0].q.slice();
    const last = this.waypoints[this.waypoints.length - 1];
    if (t >= last.t) return last.q.slice();

let i = 0;
    while (i < this.waypoints.length - 1 && this.waypoints[i + 1].t < t) i++;
    const a = this.waypoints[i];
    const b = this.waypoints[i + 1];
    const u = (t - a.t) / (b.t - a.t);

    const blend = this._blend(u);
    const out = new Array(a.q.length);
    for (let k = 0; k < a.q.length; k++) {
      out[k] = a.q[k] + (b.q[k] - a.q[k]) * blend;
    }
    return out;
  }

  _blend(u) {
    switch (this.kind) {
      case 'linear':  return u;
      case 'cubic':   return u * u * (3 - 2 * u);
      case 'quintic': return u * u * u * (u * (u * 6 - 15) + 10);
    }
    return u;
  }
}

export class TrajectoryPlayer {
  constructor(robot) {
    this.robot = robot;
    this.traj = null;
    this.t = 0;
    this.playing = false;
    this.onDone = null;
  }
  setTrajectory(traj) {
    this.traj = traj;
    this.t = 0;
  }
  play() { this.playing = !!this.traj; }
  pause() { this.playing = false; }
  stop() { this.playing = false; this.t = 0; }
  step(dt) {
    if (!this.traj) return false;
    this.t += dt;
    const q = this.traj.sample(this.t);
    this.robot.setAllJoints(q);
    if (this.t >= this.traj.duration()) {
      this.playing = false;
      if (this.onDone) { const cb = this.onDone; this.onDone = null; cb(); }
      return true;
    }
    return false;
  }
  tick(dt) {
    if (!this.playing) return;
    this.step(dt);
  }
}

export function buildLinearTrajectory(currentQ, targetQ, dur, kind = 'quintic') {
  return new Trajectory(
    [{ t: 0, q: currentQ.slice() }, { t: dur, q: targetQ.slice() }],
    { kind }
  );
}
