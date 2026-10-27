/**
 * Picking things up.
 *
 * Every holding tool has a grip point (`ee.grasp`): the middle of the space
 * between a gripper's fingers, or the face of a suction cup or magnet. IK
 * steers that point, and an object is picked up when its centre is between
 * the grip point and the fingertips. Closing a gripper (or switching suction / the magnet on) picks up what
 * is in it; opening lets go. The fingers stop where they touch the object.
 */

/** How far (beyond its half-size) an object's center may be from the grip zone (grip point to fingertips) and still be caught. */
const CATCH = 0.02;

export const gripPoint = (ee) => ee?.grasp || ee?.tip || null;

/** Is this tool currently closed / switched on? null for tools that can't hold anything. */
function holding(ee) {
  switch (ee?.type) {
    case 'gripper':
    case 'gripper3': return (ee.params?.open ?? 1) <= 0.5;
    case 'suction': return !!ee.params?.suction;
    case 'magnet': return !!ee.params?.energized;
    default: return null;
  }
}

/** Pick up whatever is at the tool's grip point. Returns the body, or null. */
export function pick(physics, ee, { quiet = false } = {}) {
  if (!physics || !ee) return null;
  if (ee.held && physics.bodies.includes(ee.held)) return ee.held;
  const at = gripPoint(ee);
  if (!at) return null;
  const body = physics.tryGrab(at, CATCH, { keepPose: true, quiet, alongTo: ee.grasp && ee.tip !== ee.grasp ? ee.tip : null });
  if (body) {
    ee.held = body;
    ee.setHold?.(body);
  }
  return body;
}

/** Let go of whatever this tool is holding. */
export function drop(physics, ee) {
  if (!physics || !ee) return;
  const at = gripPoint(ee);
  if (at) physics.release(at);
  ee.held = null;
  ee.setHold?.(null);
}

/**
 * Run once a frame: closing a tool picks up, opening it drops. Works no matter
 * what moved the gripper (a script, the Gripper slider, the end-effector list).
 */
export function autoGrip(physics, robots) {
  if (!physics) return;
  for (const r of robots) {
    for (const ee of r.endEffectors) {
      const now = holding(ee);
      if (now === null) continue;
      // Something else let go of it (reset blocks, release()): forget it.
      if (ee.held && (ee.held.attachedTo !== gripPoint(ee) || !physics.bodies.includes(ee.held))) {
        ee.held = null;
        ee.setHold?.(null);
      }
      const was = ee._wasHolding ?? now;
      ee._wasHolding = now;
      if (now && !was && !ee.held) pick(physics, ee, { quiet: true });
      else if (!now && was && ee.held) drop(physics, ee);
    }
  }
}
