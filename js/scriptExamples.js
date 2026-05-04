  // Built-in script examples shown in the Script tab's Examples dropdown.
  // Each value is the literal source dropped into the textarea on selection.

  export const SCRIPT_EXAMPLES = {
    basic: `// Simple pick-and-place trajectory.
  async function run() {
    log("Running demo trajectory...");
    await moveLinear([0, -0.4, 0.6, 0, 0.5, 0], 1.5);
    await wait(0.3);
    await ikTo(0.6, 0.4, 0.2, 1.2);
    gripper(0); // close
    await wait(0.3);
    await ikTo(0.0, 0.5, 0.7, 1.5);
    gripper(1); // open
    await moveLinear([0,0,0,0,0,0], 1.5);
    log("Done.");
  }
  run();
  `,

    loop: `// Continuous pick & place. Picks every free block in turn, drops them in a
  // stacking spot, then resets the scene and starts over.
  //
  // Requires: a gripper (or 3-finger gripper) end effector and Physics on.
  //   - The Reset blocks button does the same thing as resetBlocks() below.
  //   - Set runForever = false to do a single pass.

  async function run() {
    const dropX = -0.35, dropZ =  0.35;     // where to stack
    const hoverDy = 0.12;                    // approach height above each block
    const runForever = true;
    let stackHeight = 0.03;

    physicsOn(true);

    while (true) {
      const all = blocks();
      if (all.length === 0) {
        log("All blocks placed. Resetting...");
        await wait(0.6);
        resetBlocks();
        stackHeight = 0.03;
        await wait(0.4);
        if (!runForever) break;
        continue;
      }

      const b = all[0];
      log(\`Picking block at (\${b.x.toFixed(2)}, \${b.z.toFixed(2)})\`);

      gripper(1);
      await ikTo(b.x, b.y + hoverDy, b.z, 1.0);   // approach
      await ikTo(b.x, b.y + 0.02,    b.z, 0.5);   // descend
      grab();
      gripper(0);
      await wait(0.15);

      await ikTo(b.x, b.y + hoverDy, b.z, 0.5);   // lift
      await ikTo(dropX, stackHeight + hoverDy, dropZ, 1.0);
      await ikTo(dropX, stackHeight + 0.01,    dropZ, 0.4);
      release();
      gripper(1);
      await wait(0.15);
      await ikTo(dropX, stackHeight + hoverDy, dropZ, 0.4);

      stackHeight += 0.062;                       // next block goes on top
    }

    log("Done.");
  }
  run();
  `,

    grabOrange: `// Detect the orange block with the camera and grab it.
  //
  // Requires: gripper (primary) AND camera (aux) mounted. Physics on.
  // Tip: enable "Highlight detected blocks" on the camera to see what it sees.
  //
  // "Orange" = warm tone with r > g > b and a wide red/blue gap.

  function isOrange(b) {
    return b.r > 0.6 && b.g > 0.3 && b.g < 0.85 && b.b < 0.5
        && (b.r - b.b) > 0.35;
  }

  async function findOrange() {
    const sweep = [
      [0.1,  0.6,  0.0],
      [0.5,  0.6,  0.3],
      [0.5,  0.6, -0.3],
      [-0.2, 0.6,  0.0],
    ];
    for (const [x,y,z] of sweep) {
      await ikTo(x, y, z, 0.7);
      await wait(0.15);
      const seen = scan({ fov: Math.PI / 2.2, range: 3.0 });
      const hit = seen.find(isOrange);
      if (hit) return hit;
    }
    return null;
  }

  async function run() {
    physicsOn(true);

    log("Searching for an orange block...");
    const target = await findOrange();
    if (!target) { log("No orange block visible."); return; }

    log(\`Found orange block at (\${target.x.toFixed(2)}, \${target.z.toFixed(2)}). Picking up.\`);

    const hoverDy = 0.12;
    gripper(1);                                     // open
    await ikTo(target.x, target.y + hoverDy, target.z, 1.0);   // approach
    await ikTo(target.x, target.y + 0.02,   target.z, 0.5);   // descend
    grab();
    gripper(0);                                     // close
    await wait(0.2);
    await ikTo(target.x, target.y + hoverDy, target.z, 0.5);   // lift
    await ikTo(0.0, 0.6, 0.4, 1.2);                            // present
    log("Got it.");
  }
  run();
  `,

    beltSweep: `async function run() {
    const arms       = robots();
    const armCount   = Math.max(1, arms.length);
    const segmentLen = 1.6;
    const newLength  = segmentLen * armCount;

    const xs = arms.map(r => r.rootGroup.position.x);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    resizeConveyor({
      length: newLength,
      center: new THREE.Vector3(centerX, 0.04, -0.7),
    });
    conveyorOn(true);
    physicsOn(true);

    const closeTool = () => { gripper(0); suction(true);  magnet(true);  };
    const openTool  = () => { gripper(1); suction(false); magnet(false); };

    const me    = robotPos();
    const dropX = me.x + 0.45;
    const dropZ = me.z;
    const hover = 0.12;
    let stackH  = 0.03;
    let picked  = 0;

    log(\`Belt resized to \${newLength.toFixed(2)} m for \${armCount} robot(s).\`);

    while (true) {
      const onBelt = blocks().filter(b => b.onBelt);
      if (onBelt.length === 0) {
        await wait(0.4);
        if (blocks().filter(b => b.onBelt).length === 0) break;
        continue;
      }

      log(\`Belt has \${onBelt.length} block(s):\`);
      for (const b of onBelt) {
        log(\`  • (\${b.x.toFixed(2)}, \${b.y.toFixed(2)}, \${b.z.toFixed(2)})\`);
      }

      onBelt.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z)
                        - Math.hypot(b.x - me.x, b.z - me.z));
      let t = onBelt[0];

      openTool();
      await ikTo(t.x, t.y + hover, t.z, 0.9);

      const live = blocks().find(b => b.body === t.body) || t;
      t = live;

      await ikTo(t.x, t.y + 0.02, t.z, 0.4);
      grab();
      closeTool();
      await wait(0.15);
      await ikTo(t.x, t.y + hover, t.z, 0.4);

      await ikTo(dropX, stackH + hover, dropZ, 1.0);
      await ikTo(dropX, stackH + 0.01, dropZ, 0.4);
      release();
      openTool();
      await wait(0.15);
      await ikTo(dropX, stackH + hover, dropZ, 0.4);

      stackH += 0.062;
      picked += 1;
    }

    log(\`Done. Placed \${picked} block(s) to the robot's right.\`);
  }
  run();
  `,

  cameraSort: `// Camera-driven pick & place. Uses the on-board camera to find blocks in
// view, sorts them by color into two bins, and loops forever.
//
// Requires: a gripper AND a camera mounted (the camera is the auxiliary EE).
// Tip: enable "Highlight detected blocks" on the camera so you can see what
// the script sees.

async function run() {
  const binWarmZ =  0.35;   // red/yellow blocks go here
  const binCoolZ = -0.35;   // green/blue blocks go here
  const binX     = -0.35;
  const hoverDy  = 0.12;
  let warmH = 0.03, coolH = 0.03;

  physicsOn(true);

  // Sweep the workspace so the camera can see all blocks.
  const sweep = [
    [0.1,  0.6, 0.0],
    [0.5,  0.6, 0.3],
    [0.5,  0.6, -0.3],
    [-0.2, 0.6, 0.0],
  ];

  while (true) {
    let seen = [];
    for (const [x,y,z] of sweep) {
      await ikTo(x, y, z, 0.7);
      await wait(0.15);
      const here = scan({ fov: Math.PI/2.2, range: 3.0 });
      for (const h of here) {
        if (!seen.find(s => Math.hypot(s.x-h.x, s.z-h.z) < 0.03)) seen.push(h);
      }
    }

    if (seen.length === 0) {
      log("No blocks visible — resetting.");
      await wait(0.4);
      resetBlocks();
      warmH = 0.03; coolH = 0.03;
      await wait(0.4);
      continue;
    }

    log(\`Camera sees \${seen.length} block(s). Sorting...\`);
    for (const b of seen) {
      const isWarm = (b.r + 0.0) > b.b; // crude: red/yellow vs blue/green
      const targetZ = isWarm ? binWarmZ : binCoolZ;
      const stackY  = isWarm ? warmH    : coolH;

      gripper(1);
      await ikTo(b.x, b.y + hoverDy, b.z, 0.9);
      await ikTo(b.x, b.y + 0.02,    b.z, 0.4);
      grab();
      gripper(0);
      await wait(0.15);
      await ikTo(b.x, b.y + hoverDy, b.z, 0.4);
      await ikTo(binX, stackY + hoverDy, targetZ, 0.9);
      await ikTo(binX, stackY + 0.01,    targetZ, 0.35);
      release();
      gripper(1);
      await wait(0.15);
      await ikTo(binX, stackY + hoverDy, targetZ, 0.35);

      if (isWarm) warmH += 0.062; else coolH += 0.062;
    }
  }
}
run();
`,
};
