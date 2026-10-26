# RS CAD Integration

This document covers how the real **reBot B601 RS** CAD arm was integrated into
RoboForge alongside the original procedural arm: the offline conversion recipe, the
coordinate-frame convention, how to add another CAD arm, the assumptions made about
the RS geometry, and what changed in `scene.js` (nothing — see below).

---

## 1. What shipped

| Path | Role |
|---|---|
| `assets/rs/manifest.json` | Everything about the RS arm: per-link file, joint axis, link axis, link length, collision-capsule radius, limits, baked AABB, and per-link `parts` (the colour groups). **No magic numbers live in the JS.** |
| `assets/rs/rs_{base,j1…j6}.glb` | One decimated, origin-baked, **multi-material** mesh per moving link — each GLB carries several primitives, one per colour group (motor / structure / gripper / base), the material `name` being a robot.js colour key. (~158k tris total, ~5.4 MB.) |
| `js/meshLibrary.js` | Async provider: loads + caches each link's **coloured parts** `[{geometry, colorKey}]` (reference-counted per link), and dispatches GLB/STL/STEP for the "Import CAD…" input. |
| `js/robot.js` | `new Robot(scene, { meshSet })` + CAD branches in `_buildBase` / `_buildRevoluteHousing` / `_buildPrismaticHousing` / `_buildLinkVisual`. Each CAD link is built as a small group of tagged meshes (`j.partMeshes`), one per colour group, so the colour pickers keep working. |
| `js/persistence.js` | JSON **v3** (`model` + per-joint `mesh`), URDF `<mesh>` visuals with cylinder `<collision>`. v2 files still load. |
| `js/main.js` | Model dropdown, "Import CAD…", model swap, spawn-inherits-model, CAD-aware load paths. |
| `arm.html` | The **Model** panel (Geometry select + Import CAD button). |
| `tools/rs-cad/` | The offline converter (not loaded at runtime). See its README. |

The default model is still **Procedural** — a fresh page load behaves exactly as
before. RS is loaded on demand (dropdown, or a v3/URDF file that references it).

---

## 2. Coordinate-frame convention

> **v3 — faithful build.** The RS arm is now baked in its **real CAD orientation**
> (converter `tools/rs-cad/convert3.js`). Earlier versions "unfolded" every link into
> a straight vertical +Y stack, which distorted the shape (parts didn't mate) and
> scrambled the rotation directions (the arm folded into itself). The faithful build
> keeps each link's true orientation and drives every joint by a real `axis` +
> `parentOffset` + `tipOffset` from the manifest, so the assembled arm and its motion
> match the real hardware. `robot.js` applies `j.axisVec` / `j.tipOffset` when present
> and falls back to the cardinal `linkAxis·linkLength` layout for procedural arms.

* **Units / up-axis.** RoboForge is meters, Y-up. The RS STEP was authored in
  millimetres and already **Y-up** (the arm's tall axis is Y, base at Y = 0), so the
  only baked transform is `× 0.001` — each link is translated so its joint pivot sits
  at the local origin, with **no** rotation (real orientation preserved).
* **Per-joint frame (manifest).** `axis` = unit rotation axis in the CAD frame
  (J1 = Y yaw; J2/J3/J5 = Z pitch; J4 = forearm-roll; J6 = −X gripper-roll);
  `parentOffset` = vector to this pivot from the parent's; `tipOffset` = vector to the
  next pivot (or, for J6, to the grasp point). At the zero pose the accumulated offsets
  reproduce the CAD assembly exactly; `RS_READY_POSE` in `main.js` then opens it to a
  natural presentation pose.
* **Joint origins** come from the STEP assembly placements (extracted by
  `tools/rs-cad/frames.py`), in mm, Y-up:

  | Joint | Sub-assembly | Origin (mm) | `linkLength` (m) |
  |---|---|---|---|
  | base | `01-BASE_ASM` | (0, 0, 0) | — |
  | J1 | `02-RS-LINK-1_ASM` | (0, 75, 0) | 0.073 |
  | J2 | `03-RS-LINK-2_ASM` | (−20, 145, −8) | 0.236 |
  | J3 | `04-RS-LINK-3_ASM` | (216, 145, 0) | 0.239 |
  | J4 | `05-RS-LINK-4_ASM` | (−12, 218, 0) | 0.087 |
  | J5 | `06-RS-LINK-5_ASM` | (−99, 218, 0) | 0.059 |
  | J6 | `07-RS-GRIPPER_ASM` | (−158, 218, 0) | 0.082 |

  `linkLength` is the straight-line distance to the next joint, so the app's tip
  chain (used by IK, self-collision and EE mounting) has the arm's real proportions.

---

## 3. Lighting & material parity — and the `scene.js` summary

**`scene.js` was not modified at all.** The lighting rig, tone mapping, colour space,
fog, shadow-camera bounds and ground/grid are untouched, which is the whole point:
the CAD arm is lit by the exact same rig as the procedural arm.

Parity is achieved entirely in the material path. Every part mesh gets a
`MeshStandardMaterial` built by `robot._cadMesh()` with the same PBR values as the
procedural structural parts (`roughness 0.42, metalness 0.55`), tagged via
`_tagMat(...)` so the colour pickers and `setColor` / `resetColors` keep working.

**Colours.** The offline converter splits every link into colour groups by part
name + proximity to the joint pivot, and writes one GLB primitive per group whose
material `name` is a robot.js colour key. At load, `_cadMesh()` rebuilds a fresh
material from that key's value in the robot's `colors`. `main.js` applies a
**green-and-black** scheme per RS robot (`RS_COLORS`): **green** structural links and
gripper jaws (`link`), **black** motor modules (`revolute`), **black** pedestal
(`base`), near-black gripper body (`linkDark`) — the procedural arm keeps its own
blue/grey palette. The baseColorFactor baked into each GLB mirrors these as a fallback;
the runtime drives colour from the key, so the colour pickers still retint by category.
`castShadow` / `receiveShadow` are set on every part, so the arm casts and receives
shadows under the existing rig exactly like the procedural build.

**End effector / gripper.** The RS arm's own parallel-jaw gripper is its end effector.
The rack-and-pinion drives the two jaws apart along the gripper's **local Z** rail, so
the converter splits them by `cZ` sign into `fingerA` / `fingerB` primitives (material
name `"link|fingerA"` — green jaws). `robot.setGripperOpen(t)` slides them along Z,
driven by the **Gripper** slider in the Model panel (`robot.hasGripper()` gates it).
`RS_READY_POSE` rolls J6 by π/2 so the jaws open **vertically**. `j6.tipOffset` puts the
tip at the grasp point so the IK goal / any mounted tool sits at the jaws.

**No environment map** was added. It is optional in the brief ("if — and only if —
you decide RS needs one"), and the RS arm reads correctly as the same product under
the existing hemisphere + key + fill lights, so adding a PMREM env map — which would
have required retuning `envMapIntensity` across *every* other object (procedural EEs,
conveyor, props) and risked the drone/dose pages — was deliberately skipped. The
RS shadow fits inside the existing `sun.shadow.camera` bounds (the arm's reach is
< 0.9 m; the shadow frustum is ±4 m), so those were left as-is too.

Side-by-side, the RS arm and a procedural arm take the key-light hotspot on the same
side and cast equally soft shadows onto the ground plane.

---

## 4. Integration architecture

A **mesh-provider** layer sits beside `Robot` rather than rewriting it:

* `MeshLibrary.load('RS')` fetches the manifest and every GLB, caches each geometry
  with a reference count, and must be **awaited before** the (synchronous) `Robot`
  builder runs. `main.js` does this in `setModel` / `loadRobotData` / `loadURDFData`
  behind the loading spinner, so `addJoint` never becomes async.
* `Robot` branches on `this.meshSet`. When a CAD mesh exists for a joint's `meshId`
  the whole moving sub-assembly (link structure **plus** its RSM motor module) is
  added to the articulator as one baked mesh — so there is **no separate procedural
  housing** for CAD joints; the sub-assembly rotates as one with the joint. If a mesh
  is missing or the set failed to load, the builder falls back to procedural geometry.
* **Shared geometry is never disposed by `Robot`.** CAD meshes are flagged
  `userData.sharedGeometry`; `_disposeJoint` / `rebuildJointGeometry` skip them and
  call `MeshLibrary.releaseGeometry`. The library owns the geometry lifetime.
* Switching models **replaces** the robot instance (`_swapMeshSet`) at the same pose,
  preserving joint values when the DOF counts match, plus end effectors and colours.
* Two RS arms **share** the same 7 geometries (verified: geometry count stays flat),
  and hold ~60 fps with physics + conveyor enabled.

### UI

Left panel → **Model**: `Geometry` dropdown (`Procedural` | `RS (CAD)`) and an
**Import CAD…** button accepting `.stl,.glb,.gltf,.step,.stp`. Imported single files
are added as a static, correctly-lit prop (a "bring your own CAD" viewer); building an
*articulated* arm from an arbitrary import needs a manifest, which is the offline path.
STEP import is best-effort via a lazily `import()`-ed OpenCascade WASM from a CDN.

---

## 5. Persistence & URDF

* **JSON v3** adds top-level `"model"` and per-joint `"mesh"`. `jsonToRobot` still
  accepts v2 (defaults to procedural); loading a v3 RS file preloads the set and swaps
  the robot to the RS mesh set automatically.
* **URDF** emits `<mesh filename="package://rs/rs_<id>.glb"/>` inside `<visual>` for a
  CAD model while `<collision>` keeps the cylinder primitive. Import detects the
  `package://` mesh references, preloads the set, and round-trips the arm.

---

## 6. Adding another CAD arm

1. Get the assembly as STEP. Note each moving link's joint origin (run
   `tools/rs-cad/frames.py`, or read them off the CAD).
2. Edit `tools/rs-cad/convert.js`: set `JOINT_ORIGIN`, `ASM_TO_LINK` (sub-assembly
   name → link id), the fastener `SKIP_RE`, and joint axes if the arm isn't a
   `y,x,x,y,x,y` spherical wrist.
3. Run the pipeline in `tools/rs-cad/README.md` → produces `assets/<set>/…`.
4. Add the set id to the `#model-select` dropdown in `arm.html`. Everything else
   (loading, tagging, persistence, URDF, collision) is data-driven off the manifest.

---

## 7. Assumptions made about the RS geometry

* **DOF / mapping.** The 6 moving sub-assemblies `02-RS-LINK-1 … 07-RS-GRIPPER` are
  the 6 revolute joints J1…J6; `01-BASE` is the static pedestal. The gripper
  sub-assembly is treated as J6's link; a procedural end effector still mounts on the
  final tip (the RS jaws are visual only, not an articulated EE).
* **Joint axes.** The STEP placements carry identity orientation (translation only),
  so the axes are **not** encoded in the CAD. They are assigned as a standard
  anthropomorphic spherical-wrist arm `J1=Y, J2=X, J3=X, J4=Y, J5=X, J6=Y` — the same
  pattern as the known-good procedural `6dof` preset — so the RS arm articulates
  identically. Verified: IK converges and the arm bends sensibly.
* **Limits.** J1 ±π; J2–J6 ±2.3 rad. Nominal, not sourced from a datasheet.
* **Collision radii** are capsule **proxies**, not visual extents. The true extents
  are in each link's `aabb`. The compact wrist links (j3–j6) are hand-slimmed
  (e.g. gripper 0.129 → 0.028 m) so the straight rest pose is self-collision-free
  under the *untouched* `checkSelfCollision` capsule test; they still catch gross
  folding. Without this, stacked collinear capsules of the wide gripper/elbow
  overlapped at rest and froze the arm.
* **Zero pose.** The CAD is delivered in a folded pose; the app "unfolds" each link to
  a straight +Y canonical zero pose (the joint origins and proportions are exact; the
  resting configuration is not the CAD's frozen one).
* **Decimation.** Internal fasteners, bearings, connectors and electronics are dropped;
  surfaces are tessellated coarse and decimated to ~55% (meshoptimizer). Fine threads
  and hidden hardware are gone by design.

---

## 8. Graceful degradation

If `assets/rs/*` is missing or fails to load, `MeshLibrary.load` rejects, the app logs
a warning, keeps procedural geometry, and stays usable — no white screen. A v3/URDF
file that references an unavailable model loads as procedural.
