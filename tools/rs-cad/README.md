# RS CAD → glTF offline converter

These are the **offline** scripts that turned `assets/reBot_B601_RS_v1.0_20260625.step`
into the per-link GLBs and `assets/rs/manifest.json` that ship in the app. They are
*not* loaded by the browser and have no bearing on the runtime (no build step is added
to RoboForge). Re-run them only when the CAD changes.

## Requirements

Node 18+ and (optionally) Python 3.10+ (`frames.py` only). One-time install in this
folder:

```bash
npm install occt-import-js@0.0.23 @gltf-transform/core @gltf-transform/functions meshoptimizer
```

`occt-import-js` is OpenCascade compiled to WASM (STEP tessellation). `@gltf-transform`
+ `meshoptimizer` do the weld/quadric decimation. Neither is a RoboForge dependency.

## Pipeline (current — `convert3.js`, faithful + coloured)

`convert3.js` supersedes `convert2.js`: it bakes each link in its **real CAD
orientation** (no unfold) and writes a real kinematic frame per joint (`axis`,
`parentOffset`, `tipOffset`) plus `fingerUp`/`fingerDown` gripper roles, so the
assembled arm mates and moves like the hardware. Run it, then `decimate.js`:

```bash
node convert3.js ../../assets/reBot_B601_RS_v1.0_20260625.step out 1.2 0.9
node decimate.js out 0.55            # weld+simplify ~55%, keeps finger materials
cp out/*.glb out/manifest.json ../../assets/rs/
```

Joint axes/pivots were cross-checked against the fully-assembled reference mesh
`assets/DoseHumanoidArm.stl`. The older single-material / unfolded pipelines follow.

## Legacy pipeline (`convert2.js` — coloured, multi-material)

```bash
# 0. (optional) inspect the assembly tree / triangle budget / colours / parts
node inspect.js ../../assets/reBot_B601_RS_v1.0_20260625.step
node colors.js  ../../assets/reBot_B601_RS_v1.0_20260625.step   # per-link STEP palette
node parts.js   ../../assets/reBot_B601_RS_v1.0_20260625.step   # per-link solids + motor centroids

# 1. tessellate + split each link into COLOUR groups + unfold gripper + bake GLBs.
#    Seed the output dir with the previous manifest.json first so the hand-tuned
#    collisionRadius / min / max / jointAxis fields are preserved.
mkdir -p out && cp ../../assets/rs/manifest.json out/ 2>/dev/null || true
node convert2.js ../../assets/reBot_B601_RS_v1.0_20260625.step out 1.2 0.9
#   args: <step> <outDir> [linearDeflectionMM] [angularDeflectionRad]

# 2. weld + decimate ~55% in place (keeps per-primitive materials/colours)
node decimate.js out 0.55

# 3. publish
cp out/*.glb out/manifest.json ../../assets/rs/
```

Result: ~158k triangles total, ~5.4 MB, each GLB a multi-material mesh whose material
`name`s are robot.js colour keys (`revolute`, `link`, `base`, `linkDark`). The original
single-material `convert.js` is kept for reference; `convert2.js` supersedes it.

## What `convert2.js` bakes in

* **Grouping** — meshes are bucketed into the 7 top-level sub-assemblies
  (`01-BASE_ASM`, `02-RS-LINK-1_ASM` … `07-RS-GRIPPER_ASM`) via the occt node tree.
* **Skip list** — internal fasteners / bearings / connectors / electronics
  (`7-HM*`, `7-KA*`, `7-KM*`, `9-XT30*`, `9-SOCKET*`, `9-M-RS*`, `6-BEARING*`,
  `6-THRUST*`, `6-SILICONE*`, `2-CD*`) are dropped to cut clutter and triangles.
* **Joint origins** — hard-coded in `JOINT_ORIGIN` (mm, Y-up), extracted from the
  STEP assembly placements by `frames.py`. If you re-source a different arm, re-run
  `frames.py` and paste the new origins.
* **Bake** — each moving link is translated so its joint origin sits at the local
  origin, unfolded so the vector to the next joint points along `+Y` (canonical
  straight zero pose), and scaled mm→m. Normals are transformed with it.
* **Colours** — within each link, solids are bucketed into colour groups
  (`colorKeyFor`): named motor solids (`RSM*`/`*STATOR*`/`*ROTOR*`/`M6`/`M7`) and any
  solid within `MOTOR_R` mm of the joint pivot → `revolute` (blue); gripper mechanism
  (`RACK`/`GEAR`/`RAIL`) → `linkDark`; base pedestal → `base`; everything else →
  `link`. Each group is written as its own GLB primitive with a named material.
* **Gripper unfold** — the last link (`j6`) has no "next joint", so it is unfolded
  along its wrist→grip principal direction (mean of the gripper-mechanism geometry)
  so the jaws point `+Y`, and its `linkLength` is set to the grasp point.
* **manifest.json** — `linkLength` = joint-to-joint distance; `collisionRadius` =
  capsule proxy (see the note field — the wrist values are hand-tuned so the straight
  pose is self-collision-free); `aabb` = true baked extent; `jointAxis` is the
  kinematic assignment (see `RS-INTEGRATION.md`).
