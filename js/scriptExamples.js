// Example scripts for the Script tab. Each one sets up what it needs.

export const SCRIPT_EXAMPLES = {
  basic: `// Pick up the orange block and put it down somewhere else.
mountTool('gripper');
resetBlocks();
physicsOn();
await wait(0.5);

const b = blocks()[0];                   // the orange block
gripper(1);                              // open
await ikTo(b.x, b.y + 0.15, b.z, 1.0);   // above it
await ikTo(b.x, b.y + 0.03, b.z, 0.6);   // jaws around its top
gripper(0);                              // close: picked up
await ikTo(b.x, 0.3, b.z, 0.6);
await ikTo(0.15, 0.3, 0.45, 1.2);
await ikTo(0.15, 0.08, 0.45, 0.6);
gripper(1);                              // open: put down
await ikTo(0.15, 0.3, 0.45, 0.5);
log('[pick] placed');
`,

  loop: `// Stack every block in one spot, reset, and go again.
mountTool('gripper');
physicsOn();

const drop = { x: -0.35, z: 0.35 };
const size = 0.06;

while (true) {
  const todo = blocks();
  if (todo.length === 0) {
    resetBlocks();
    await wait(0.8);
    continue;
  }
  for (let i = 0; i < todo.length; i++) {
    const b = todo[i];
    gripper(1);
    await ikTo(b.x, b.y + 0.15, b.z, 1.0);
    await ikTo(b.x, b.y + 0.03, b.z, 0.5);
    gripper(0);
    await ikTo(b.x, b.y + 0.15, b.z, 0.5);

    const h = size / 2 + i * size;
    await ikTo(drop.x, h + 0.15, drop.z, 1.0);
    await ikTo(drop.x, h + 0.01, drop.z, 0.4);
    gripper(1);
    await ikTo(drop.x, h + 0.15, drop.z, 0.4);
  }
  log(\`[loop] stacked \${todo.length}\`);
  clearBlocks();
}
`,

  grabOrange: `// Look around with the camera, find the orange block, pick it up.
mountTool('gripper');
mountTool('camera');
physicsOn();

const isOrange = (b) => b.r > 0.6 && b.g > 0.3 && b.g < 0.85 && b.b < 0.5 && b.r - b.b > 0.35;
const lookouts = [[0.1, 0.6, 0.0], [0.5, 0.6, 0.3], [0.5, 0.6, -0.3], [-0.2, 0.6, 0.0]];

let target = null;
for (const [x, y, z] of lookouts) {
  await ikTo(x, y, z, 0.7);
  await wait(0.15);
  target = scan({ fov: Math.PI / 2.2, range: 3 }).find(isOrange);
  if (target) break;
}
if (!target) {
  log('[camera] no orange block in view');
} else {
  log(\`[camera] orange block at \${target.x.toFixed(2)}, \${target.z.toFixed(2)}\`);
  gripper(1);
  await ikTo(target.x, target.y + 0.15, target.z, 1.0);
  await ikTo(target.x, target.y + 0.03, target.z, 0.5);
  gripper(0);
  await ikTo(target.x, target.y + 0.15, target.z, 0.5);
  await ikTo(0.0, 0.6, 0.4, 1.2);
  log('[camera] holding it');
}
`,

  cameraSort: `// Sort blocks by color: warm ones to one bin, cool ones to the other.
mountTool('gripper');
mountTool('camera');
physicsOn();

const bins = { warm: { x: -0.35, z: 0.35, h: 0.03 }, cool: { x: -0.35, z: -0.35, h: 0.03 } };
const lookouts = [[0.1, 0.6, 0.0], [0.5, 0.6, 0.3], [0.5, 0.6, -0.3], [-0.2, 0.6, 0.0]];

while (true) {
  const seen = [];
  for (const [x, y, z] of lookouts) {
    await ikTo(x, y, z, 0.7);
    await wait(0.15);
    for (const h of scan({ fov: Math.PI / 2.2, range: 3 })) {
      if (!seen.some(s => Math.hypot(s.x - h.x, s.z - h.z) < 0.03)) seen.push(h);
    }
  }
  if (seen.length === 0) {
    log('[sort] nothing in view, resetting');
    resetBlocks();
    bins.warm.h = bins.cool.h = 0.03;
    await wait(0.8);
    continue;
  }
  log(\`[sort] \${seen.length} blocks\`);
  for (const b of seen) {
    const bin = b.r > b.b ? bins.warm : bins.cool;
    gripper(1);
    await ikTo(b.x, b.y + 0.15, b.z, 0.9);
    await ikTo(b.x, b.y + 0.03, b.z, 0.4);
    gripper(0);
    await ikTo(b.x, b.y + 0.15, b.z, 0.4);
    await ikTo(bin.x, bin.h + 0.15, bin.z, 0.9);
    await ikTo(bin.x, bin.h + 0.01, bin.z, 0.35);
    gripper(1);
    await ikTo(bin.x, bin.h + 0.15, bin.z, 0.35);
    bin.h += 0.062;
  }
}
`,

  beltSweep: `// Every robot takes blocks off the conveyor and stacks them to its right.
// Add more robots first to share the belt between them.
mountTool('gripper');
physicsOn();

const arms = robots();
const xs = arms.map(r => r.rootGroup.position.x);
resizeConveyor({
  length: 1.6 * Math.max(1, arms.length),
  center: new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, 0.04, -0.7),
});
conveyorOn(true);

const me = robotPos();
const drop = { x: me.x + 0.45, z: me.z };
let h = 0.03, picked = 0;

while (true) {
  const onBelt = blocks().filter(b => b.onBelt)
    .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
  if (onBelt.length === 0) {
    await wait(0.4);
    if (!blocks().some(b => b.onBelt)) break;
    continue;
  }
  let t = onBelt[0];
  gripper(1);
  await ikTo(t.x, t.y + 0.15, t.z, 0.9);
  t = blocks().find(b => b.body === t.body) || t;   // it moved while we came over
  await ikTo(t.x, t.y + 0.03, t.z, 0.4);
  gripper(0);
  await ikTo(t.x, t.y + 0.15, t.z, 0.4);
  await ikTo(drop.x, h + 0.15, drop.z, 1.0);
  await ikTo(drop.x, h + 0.01, drop.z, 0.4);
  gripper(1);
  await ikTo(drop.x, h + 0.15, drop.z, 0.4);
  h += 0.062;
  picked += 1;
}
log(\`[belt] placed \${picked}\`);
`,
};
