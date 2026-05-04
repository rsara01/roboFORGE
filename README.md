# RoboForge — 6-DOF Robotic Arm Simulator

An interactive, browser-based 3D simulation environment for designing, programming, and
testing robotic arms (up to 6 DOF). Built with vanilla JavaScript ES modules and
[Three.js](https://threejs.org/).

![viewport](https://img.shields.io/badge/three.js-r160-blue) ![no-build](https://img.shields.io/badge/no%20build%20step-green)

## Features

### Scene & viewport
- Orbit / pan / zoom camera (mouse + touch)
- Shadow-mapped lighting, ground plane and grid
- World axes + per-joint frame axes (toggleable)

### Modular arm builder
- Add **revolute** or **prismatic** joints (up to 6 DOF)
- Adjustable axis (X/Y/Z), link length, link radius, value, min, max
- Built-in presets: 6-DOF industrial arm, SCARA, Cartesian gantry
- Live hierarchy / tree view

### Manipulation
- TransformControls gizmos that rotate revolute joints and translate prismatic ones
- Drag the orange IK target sphere to position the end effector with CCD IK
- Sliders + numeric inputs for every joint, plus per-joint min/max editors

### End effectors (hot-swappable)
- Gripper (with 0–1 open parameter and pickup support)
- Suction cup (toggle vacuum)
- Welding tool (animated arc)
- Camera / sensor module (with optional frustum visualizer)

### Programming & control
- Built-in **scripting panel** running JavaScript with helpers:
  `setJoint`, `getJoint`, `moveTo`, `moveLinear`, `ikTo`, `wait`,
  `gripper`, `suction`, `weld`, `log`
- Trajectory player with smooth (linear/cubic/quintic) interpolation
- Play / Pause / Step / Stop simulation controls + speed scrubber
- Optional **inverse kinematics** (CCD) — solve once or continuously track

### Visualization
- Real-time end-effector position readout
- Path tracing of the end effector
- Real-time joint-value plot (rolling 20 s window)

### Persistence
- Save / load robot config as **JSON**
- Export / import a simplified **URDF**-style XML

### Optional physics
- Gravity + ground collision for free dynamic objects (toggle in the View Options panel)
- Gripper / suction can attach the nearest free body to its tip

### Keyboard shortcuts
| Key | Action |
| --- | --- |
| `R` / `T` / `G` | Rotate / Translate / Toggle gizmo |
| `Space` | Play / Pause |
| `S` | Step one tick |
| `X` | Stop / reset sim |
| `1`–`6` | Select joint N |
| `← / →` | Nudge selected joint value |
| `Esc` | Deselect |
| `Delete` | Delete selected joint (and chain after it) |
| `F` | Frame robot in view |
| `⌘/Ctrl + S` | Save robot to JSON |

## Project structure

```
robot-arm-sim/
├── index.html          – layout + import map (loads three.js from unpkg)
├── styles.css          – all UI styles
├── serve.py            – tiny static file server (optional)
└── js/
    ├── main.js         – entry point: wires everything together
    ├── scene.js        – Three.js scene, camera, renderer, gizmo, picking
    ├── robot.js        – joints, links, forward kinematics
    ├── ik.js           – CCD inverse kinematics solver + tracker
    ├── endEffectors.js – gripper / suction / welder / camera library
    ├── trajectory.js   – joint trajectory representation + player
    ├── scripting.js    – sandboxed user-script runtime
    ├── persistence.js  – JSON & URDF import/export
    ├── plot.js         – rolling joint-value canvas plot
    ├── physics.js      – tiny gravity + pickup
    ├── shortcuts.js    – keyboard shortcuts
    └── ui.js           – DOM panels, sliders, hierarchy, inspector
```

## Running locally

The app uses ES module imports, so it must be served over HTTP (not opened from
`file://`). Three.js is fetched from a CDN via an import map, so there is **no
build step and no `npm install`** required.

### Option 1 — bundled Python server

```bash
cd robot-arm-sim
python3 serve.py        # serves on http://localhost:8000
```

Open <http://localhost:8000> in any modern browser.

### Option 2 — any other static server

```bash
cd robot-arm-sim
# Python builtin
python3 -m http.server 8000
# OR Node
npx serve .
# OR PHP
php -S localhost:8000
```

### Browser requirements
A current Chromium / Firefox / Safari with WebGL 2 support. The app relies on
ES module **import maps** (Chrome 89+, Firefox 108+, Safari 16.4+).

## Quick tour

1. The page loads with a 6-DOF preset already built. Drag the viewport to orbit.
2. Click any joint or link in the 3D scene (or in the **Hierarchy** panel) to
   select it. A rotation gizmo appears — drag the rings to articulate.
3. Use the right-side **All Joints** sliders for precise control, or open the
   **IK** tab and drag the orange target sphere to drive the end effector.
4. Switch end effectors with the **End Effector** dropdown in the left panel.
5. Open the **Script** tab and click **▶ Run** to execute the demo trajectory.
   The simulation will auto-play while the script runs.
6. Toggle **End-effector trace** under View Options to see the path being
   traced in space.
7. Open the **Plot** tab to watch joint values over time.
8. Use **Save JSON** / **Load JSON** in the top bar to persist a robot
   configuration. **Export URDF** writes a simplified URDF-style XML.

## Programming model

Every script runs as an `async` function with helpers in scope:

```js
// Move all joints to a target vector with smooth quintic blending
await moveLinear([0, -0.4, 0.6, 0, 0.5, 0], 1.5);

// Wait for some sim time
await wait(0.5);

// Use IK to drive end effector to a world XYZ
await ikTo(0.6, 0.4, 0.2, 1.2);

// End-effector control
gripper(0);   // 0 = closed, 1 = open
suction(1);   // 1 = on
weld(0);      // welder on/off

// Read state
log(getAllJoints());
```

Internally, time advances only while the simulation is playing — the script's
`await wait(0.5)` waits for **0.5 sim seconds**, not wall-clock seconds, so
everything stays consistent when you change the speed scrubber.

## Extending

- **New end effectors:** add a factory to [`js/endEffectors.js`](js/endEffectors.js) and
  register the type name in `EE_TYPES` plus the `<select>` in [`index.html`](index.html).
- **New joint types:** extend the `Joint` model in [`js/robot.js`](js/robot.js) and
  the IK solver in [`js/ik.js`](js/ik.js).
- **Smarter IK / trajectories:** the current solver is CCD with per-frame
  iteration budget; replace `solveIK` with Jacobian-DLS or QP without
  touching the rest of the app.
- **Real physics:** drop in [`cannon-es`](https://github.com/pmndrs/cannon-es) or
  [`rapier`](https://rapier.rs/) and expand [`js/physics.js`](js/physics.js).

## License

MIT — use, modify, and ship freely.
