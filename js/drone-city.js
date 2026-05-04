// Procedural city scene. Replaces the OSM-tile terrain with a deterministic
// fictional grid of streets and rectangular buildings. Provides the same
// heightAt(x, z) interface so DronePhysics can land on the ground or on
// rooftops without changes.

import * as THREE from 'three';

export class City {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);

    this.extent = opts.extent ?? 220;     // half-size of the city footprint
    this.blockSize = opts.blockSize ?? 26;
    this.streetWidth = opts.streetWidth ?? 6;
    this.seed = opts.seed ?? 1337;

    this.buildings = [];                  // [{x, z, w, d, h}]
    this._buildScene();

    // Stubs for compatibility with the old terrain export interface.
    this.origin = { lat: 0, lon: 0 };
    this.label = 'Procedural City';
  }

  // Old API stubs kept so other modules don't need to know we replaced terrain.
  toLatLon(x, z) {
    // Pretend each meter is ~1e-5 deg (rough). Just for export-script numbers.
    return { lat: this.origin.lat + z * 9e-6, lon: this.origin.lon + x * 9e-6 };
  }
  setOrigin() { /* no-op */ }
  setAddress() { return Promise.resolve({ display: this.label }); }

  _buildScene() {
    const rng = mulberry32(this.seed);
    const period = this.blockSize + this.streetWidth;
    const ext = this.extent;

    // ---- ground (asphalt-ish) ----------------------------------------
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ext * 2.4, ext * 2.4),
      new THREE.MeshStandardMaterial({ color: 0x1f232a, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // ---- street grid (slightly lighter strips on top of ground) -------
    const streetMat = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.85 });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xe6c66a });
    const numStreets = Math.ceil((ext * 2) / period) + 1;
    for (let i = -numStreets; i <= numStreets; i++) {
      const c = i * period;
      // East-west street
      const ew = new THREE.Mesh(
        new THREE.PlaneGeometry(ext * 2, this.streetWidth),
        streetMat
      );
      ew.rotation.x = -Math.PI / 2;
      ew.position.set(0, 0.02, c);
      ew.receiveShadow = true;
      this.group.add(ew);
      // Centerline dashes
      const ewLine = new THREE.Mesh(
        new THREE.PlaneGeometry(ext * 2, 0.18),
        stripeMat
      );
      ewLine.rotation.x = -Math.PI / 2;
      ewLine.position.set(0, 0.03, c);
      this.group.add(ewLine);

      // North-south street
      const ns = new THREE.Mesh(
        new THREE.PlaneGeometry(this.streetWidth, ext * 2),
        streetMat
      );
      ns.rotation.x = -Math.PI / 2;
      ns.position.set(c, 0.02, 0);
      ns.receiveShadow = true;
      this.group.add(ns);
      const nsLine = new THREE.Mesh(
        new THREE.PlaneGeometry(0.18, ext * 2),
        stripeMat
      );
      nsLine.rotation.x = -Math.PI / 2;
      nsLine.position.set(c, 0.03, 0);
      this.group.add(nsLine);
    }

    // ---- buildings ----------------------------------------------------
    const palette = [
      0x6e7c8a, 0x8a8278, 0x546273, 0x9aa3a8, 0x3b4148,
      0x7a6b5a, 0x4d5b6a, 0xa9a298, 0x5e6e80,
    ];
    const matFor = (c) => new THREE.MeshStandardMaterial({
      color: c, roughness: 0.65, metalness: 0.1,
      // A faint emissive so the windows-texture below glows just enough.
      emissive: 0x111418, emissiveIntensity: 0.5,
    });
    const mats = palette.map(matFor);

    // Generate a window texture once and share via UV scaling per building.
    const winTex = makeWindowTexture();

    const halfBlocks = Math.floor(ext / period);
    for (let xi = -halfBlocks; xi <= halfBlocks; xi++) {
      for (let zi = -halfBlocks; zi <= halfBlocks; zi++) {
        // Reserve a small plaza near origin so the spawn area is open.
        if (Math.abs(xi) <= 1 && Math.abs(zi) <= 1) continue;

        const cx = xi * period;
        const cz = zi * period;

        // Fill the block with 1-3 buildings, each with its own footprint.
        const n = 1 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
          const maxW = (this.blockSize - 2) / Math.sqrt(n);
          const w = 5 + rng() * (maxW - 4);
          const d = 5 + rng() * (maxW - 4);
          // Heavy-tailed height distribution: most low, a few skyscrapers.
          const h = 5 + Math.pow(rng(), 2.2) * 70;
          const ox = (rng() - 0.5) * (this.blockSize - w - 0.5);
          const oz = (rng() - 0.5) * (this.blockSize - d - 0.5);
          const x = cx + ox;
          const z = cz + oz;

          const baseMat = mats[Math.floor(rng() * mats.length)];
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, d),
            baseMat
          );
          mesh.position.set(x, h / 2, z);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.group.add(mesh);

          // Window overlay: a slightly larger transparent shell carrying the
          // window texture, repeated proportional to facade size (~3.2 m per
          // story). One overlay per building — cheap and convincing.
          const winMap = winTex.clone();
          winMap.needsUpdate = true;
          winMap.wrapS = winMap.wrapT = THREE.RepeatWrapping;
          const repX = Math.max(2, Math.round(Math.max(w, d) / 2.5));
          const repY = Math.max(2, Math.round(h / 3.2));
          winMap.repeat.set(repX, repY);
          const overlay = new THREE.Mesh(
            new THREE.BoxGeometry(w * 1.005, h * 0.96, d * 1.005),
            new THREE.MeshBasicMaterial({
              map: winMap,
              transparent: true,
              opacity: 0.85,
              depthWrite: false,
            })
          );
          overlay.position.set(x, h / 2, z);
          this.group.add(overlay);

          this.buildings.push({ x, z, w, d, h });
        }
      }
    }
  }

  // Returns ground height (0) or rooftop height if (x, z) is inside a building.
  // Used for spawn placement, HUD AGL display, and ray-trace ground hits.
  heightAt(x, z) {
    for (const b of this.buildings) {
      if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) {
        return b.h;
      }
    }
    return 0;
  }

  // Solid-body collision against every building AABB. Mutates `pos` and `vel`
  // in place: pushes the drone out along the shallowest penetration axis and
  // zeroes the velocity component into the wall. The drone is approximated as
  // a vertical cylinder of radius `r`.
  //
  // Behavior:
  //   - Drone above rooftop: no horizontal push (the ground/rooftop handler
  //     in physics.step lands it on the roof normally).
  //   - Drone inside footprint AND below rooftop: pick min(overlapX, overlapZ,
  //     overlapTop) and push that direction. Top wins when the drone is
  //     descending onto the roof from just above; sides win otherwise.
  collide(pos, vel, r) {
    for (const b of this.buildings) {
      const halfW = b.w / 2 + r;
      const halfD = b.d / 2 + r;
      const dx = pos.x - b.x;
      const dz = pos.z - b.z;
      if (Math.abs(dx) >= halfW || Math.abs(dz) >= halfD) continue;

      const topY = b.h + r * 0.3;
      if (pos.y > topY) continue;          // safely above rooftop, skip

      const overlapTop = topY - pos.y;     // pop up to roof
      const overlapX   = halfW - Math.abs(dx);
      const overlapZ   = halfD - Math.abs(dz);

      if (overlapTop <= overlapX && overlapTop <= overlapZ) {
        pos.y = topY;
        if (vel.y < 0) vel.y = 0;
        vel.x *= 0.85; vel.z *= 0.85;
      } else if (overlapX <= overlapZ) {
        pos.x += Math.sign(dx) * overlapX;
        if (vel.x * dx < 0) vel.x = 0;
      } else {
        pos.z += Math.sign(dz) * overlapZ;
        if (vel.z * dz < 0) vel.z = 0;
      }
    }
  }
}

// Deterministic 32-bit RNG so the city looks identical across reloads.
function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Produces a small canvas texture that looks like a row of lit windows on
// a dark facade. Used as a tileable overlay on each building's exterior.
function makeWindowTexture() {
  const w = 64, h = 64;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  // Dark facade backdrop.
  ctx.fillStyle = 'rgba(15, 18, 22, 0.55)';
  ctx.fillRect(0, 0, w, h);
  // Window rows.
  const cols = 4;
  const rowH = 16;
  for (let row = 0; row < h / rowH; row++) {
    for (let c = 0; c < cols; c++) {
      const lit = Math.random() < 0.65;
      const cx = c * (w / cols) + 4;
      const cy = row * rowH + 4;
      const ww = (w / cols) - 8;
      const hh = rowH - 8;
      ctx.fillStyle = lit
        ? `rgba(255, ${200 + Math.floor(Math.random() * 50)}, ${100 + Math.floor(Math.random() * 70)}, 0.9)`
        : 'rgba(60, 70, 80, 0.7)';
      ctx.fillRect(cx, cy, ww, hh);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  return tex;
}
