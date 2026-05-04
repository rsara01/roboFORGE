

import * as THREE from 'three';
import { buildLinearTrajectory } from './trajectory.js';
import { solveIK } from './ik.js';

const SCRIPT_CANCELLED = Symbol('SCRIPT_CANCELLED');

export class ScriptRunner {
  constructor(robot, simClock, output, physics = null, app = null) {
    this.robot = robot;
    this.simClock = simClock;
    this.output = output;
    this.physics = physics;
    this.app = app;
    this.cancelToken = { cancelled: false };
  }

  setRobot(robot) { this.robot = robot; }

  log(msg) {
    if (this.output) {
      const line = (typeof msg === 'string' ? msg : JSON.stringify(msg));
      this.output.textContent += line + '\n';
      this.output.scrollTop = this.output.scrollHeight;
    }
  }

  clearOutput() { if (this.output) this.output.textContent = ''; }

  stop() {
    this.cancelToken.cancelled = true;

    this.simClock?.wakeUp?.();
  }

async run(source) {
    this.cancelToken = { cancelled: false };
    const token = this.cancelToken;
    const robot = this.robot;
    const sim = this.simClock;
    const physics = this.physics;
    const log = (m) => this.log(m);

    const findEE = (type) => robot.endEffectors.find(e => e.type === type) || null;
    const primary = () => robot.endEffectors[0] || null;

    const grab = () => {
      const ee = primary();
      return physics && ee?.tip ? physics.tryGrab(ee.tip) : null;
    };
    const release = () => {
      const ee = primary();
      return physics && ee?.tip ? physics.release(ee.tip) : null;
    };

    const scan = ({ fov = Math.PI / 3, range = 2.0 } = {}) => {
      if (!physics) return [];

      const ee = findEE('camera') || primary();
      const useCone = ee?.type === 'camera' && ee.tip;
      let camPos, camFwd;
      if (useCone) {
        ee.tip.updateWorldMatrix(true, false);
        camPos = new THREE.Vector3().setFromMatrixPosition(ee.tip.matrixWorld);
        camFwd = new THREE.Vector3(0, 0, 1)
          .applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(ee.tip.matrixWorld))
          .normalize();
      }
      const out = [];
      const wp = new THREE.Vector3();
      for (const b of physics.bodies) {
        if (b.attachedTo) continue;
        wp.setFromMatrixPosition(b.mesh.matrixWorld);
        if (useCone) {
          const dir = wp.clone().sub(camPos);
          const dist = dir.length();
          if (dist > range) continue;
          const ang = Math.acos(THREE.MathUtils.clamp(dir.normalize().dot(camFwd), -1, 1));
          if (ang > fov / 2) continue;
        }
        const c = b.mesh.material.color;
        out.push({
          x: wp.x, y: wp.y, z: wp.z,
          color: (c.r * 255 << 16) | (c.g * 255 << 8) | (c.b * 255),
          r: c.r, g: c.g, b: c.b,
        });
      }
      return out;
    };

const setJoint = (i, v) => robot.setJointValue(i, +v);
    const getJoint = (i) => robot.getJointValue(i);
    const getAllJoints = () => robot.joints.map(j => j.value);

    const ckc = () => { if (token.cancelled) throw SCRIPT_CANCELLED; };

    const wait = async (seconds) => {
      ckc();
      await sim.wait(seconds, token);
      ckc();
    };

const moveTo = async (i, target, duration = 1.0) => {
      ckc();
      const start = robot.getJointValue(i);
      const t0 = sim.now();
      while (!token.cancelled) {
        const t = sim.now() - t0;
        const u = Math.min(1, duration <= 0 ? 1 : t / duration);
        const blend = u * u * u * (u * (u * 6 - 15) + 10);
        robot.setJointValue(i, start + (target - start) * blend);
        if (u >= 1) break;
        await sim.nextFrame(token);
      }
      ckc();
    };

const moveLinear = async (target, duration = 1.0) => {
      ckc();
      const start = getAllJoints();
      const t0 = sim.now();
      while (!token.cancelled) {
        const t = sim.now() - t0;
        const u = Math.min(1, duration <= 0 ? 1 : t / duration);
        const blend = u * u * u * (u * (u * 6 - 15) + 10);
        for (let i = 0; i < target.length && i < robot.joints.length; i++) {
          robot.setJointValue(i, start[i] + (target[i] - start[i]) * blend);
        }
        if (u >= 1) break;
        await sim.nextFrame(token);
      }
      ckc();
    };

const ikTo = async (x, y, z, duration = 1.0) => {
      ckc();
      if (robot.floorClearance && y < robot.floorY + 0.02) y = robot.floorY + 0.02;
      const target = new THREE.Vector3(x, y, z);
      const startEE = robot.getEndEffectorWorldPosition(new THREE.Vector3());
      const t0 = sim.now();
      while (!token.cancelled) {
        const t = sim.now() - t0;
        const u = Math.min(1, duration <= 0 ? 1 : t / duration);
        const blend = u * u * u * (u * (u * 6 - 15) + 10);
        const interp = startEE.clone().lerp(target, blend);
        solveIK(robot, interp, { maxIter: 6, tolerance: 0.003 });
        if (u >= 1) break;
        await sim.nextFrame(token);
      }
      ckc();
    };

const gripper = (open01) => {
      const ee = findEE('gripper') || findEE('gripper3');
      if (ee) ee.setParam('open', open01);
    };
    const suction = (on) => {
      const ee = findEE('suction');
      if (ee) ee.setParam('suction', on);
    };
    const weld = (on) => {
      const ee = findEE('welder');
      if (ee) ee.setParam('welding', on);
    };
    const drill = (on) => {
      const ee = findEE('drill');
      if (ee) ee.setParam('spinning', on);
    };
    const magnet = (on) => {
      const ee = findEE('magnet');
      if (ee) ee.setParam('energized', on);
    };
    const laser = (on) => {
      const ee = findEE('laser');
      if (ee) ee.setParam('firing', on);
    };
    const paint = (on, color) => {
      const ee = findEE('paint');
      if (!ee) return;
      ee.setParam('spraying', on);
      if (color != null) ee.setParam('color', color);
    };

    const blocks = () => {
      if (!physics) return [];
      const out = [];
      const wp = new THREE.Vector3();
      for (const b of physics.bodies) {
        if (b.attachedTo && b.attachedTo.isObject3D) continue;
        b.mesh.updateWorldMatrix(true, false);
        wp.setFromMatrixPosition(b.mesh.matrixWorld);
        const c = b.mesh.material.color;
        out.push({
          x: wp.x, y: wp.y, z: wp.z,
          color: c.getHex(), body: b,
          onBelt: !!(b.attachedTo && !b.attachedTo.isObject3D),
        });
      }
      return out;
    };

    const resetBlocks = () => physics?.resetBlocks();
    const physicsOn = (on = true) => physics?.setEnabled(!!on);

    const app = this.app;
    const conveyor = () => app?.conveyor || null;
    const conveyorOn = (on = true) => app?.conveyor?.setEnabled(!!on);
    const resizeConveyor = (opts = {}) => app?.conveyor?.resize(opts);
    const robots = () => app?.robots || [];
    const robotPos = (idx = app?.activeRobotIdx ?? 0) => {
      const r = app?.robots?.[idx];
      if (!r) return new THREE.Vector3();
      return r.rootGroup.position.clone();
    };

    const api = {
      setJoint, getJoint, getAllJoints,
      moveTo, moveLinear, ikTo, wait,
      gripper, suction, weld, drill, magnet, laser, paint,
      grab, release, scan, blocks, resetBlocks, physicsOn,
      conveyor, conveyorOn, resizeConveyor, robots, robotPos,
      log,
      THREE,
    };

const argNames = Object.keys(api);
    const argValues = argNames.map(k => api[k]);

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
