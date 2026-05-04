

import * as THREE from 'three';

const ZOOM = 14;
const TILE_SPAN = 5;
const HEIGHT_SAMPLES = 64;
const VERT_SCALE = 1.0;
const METERS_PER_DEG_LAT = 111320;

const TILE_PROVIDERS = {

  terrariumPNG: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
};

function lon2tile(lon, z) { return ((lon + 180) / 360) * Math.pow(2, z); }
function lat2tile(lat, z) {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
}
function metersPerTile(lat, z) {
  const C = 40075016.686 * Math.cos(lat * Math.PI / 180);
  return C / Math.pow(2, z);
}

function decodeTerrarium(imageBitmap, samples) {

  const c = document.createElement('canvas');
  c.width = c.height = samples;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imageBitmap, 0, 0, samples, samples);
  const data = ctx.getImageData(0, 0, samples, samples).data;
  const out = new Float32Array(samples * samples);
  for (let i = 0; i < samples * samples; i++) {
    const r = data[i * 4 + 0];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    out[i] = (r * 256 + g + b / 256) - 32768;
  }
  return out;
}

export class Terrain3D {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'terrain3d';
    scene.add(this.group);
    this.origin = { lat: 37.7749, lon: -122.4194 };
    this.label = 'San Francisco, CA (default)';
    this._loader = new THREE.TextureLoader();
    this._loader.crossOrigin = 'anonymous';
    this._build();
  }

  async setAddress(address) {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address);
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('Geocoding failed (' + r.status + ')');
    const arr = await r.json();
    if (!arr.length) throw new Error('Address not found');
    const lat = parseFloat(arr[0].lat);
    const lon = parseFloat(arr[0].lon);
    const display = arr[0].display_name || address;
    this.setOrigin(lat, lon, display);
    return { lat, lon, display };
  }

  setOrigin(lat, lon, label = '') {
    this.origin = { lat, lon };
    this.label = label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    this._build();
  }

  toLatLon(x, z) {
    const dLat = -z / METERS_PER_DEG_LAT;
    const dLon =  x / (METERS_PER_DEG_LAT * Math.cos(this.origin.lat * Math.PI / 180));
    return { lat: this.origin.lat + dLat, lon: this.origin.lon + dLon };
  }

  heightAt(x, z) {
    if (!this._tiles) return 0;
    const m = this.metersPerTile;
    for (const t of this._tiles) {
      const lx = x - t.cx;
      const lz = z - t.cz;
      if (lx < -m / 2 || lx > m / 2 || lz < -m / 2 || lz > m / 2) continue;
      if (!t.heights) return 0;
      const u = (lx + m / 2) / m;
      const v = (lz + m / 2) / m;
      const ix = Math.min(HEIGHT_SAMPLES - 1, Math.max(0, Math.floor(u * (HEIGHT_SAMPLES - 1))));
      const iy = Math.min(HEIGHT_SAMPLES - 1, Math.max(0, Math.floor(v * (HEIGHT_SAMPLES - 1))));
      return t.heights[iy * HEIGHT_SAMPLES + ix] - this._heightOffset;
    }
    return 0;
  }

  _build() {

    while (this.group.children.length) {
      const c = this.group.children.pop();
      c.geometry?.dispose?.();
      if (c.material) {
        c.material.map?.dispose?.();
        c.material.dispose?.();
      }
    }
    this._tiles = [];
    this._heightOffset = 0;

    this.metersPerTile = metersPerTile(this.origin.lat, ZOOM);
    const m = this.metersPerTile;

    const cx = lon2tile(this.origin.lon, ZOOM);
    const cy = lat2tile(this.origin.lat, ZOOM);
    const ix = Math.floor(cx);
    const iy = Math.floor(cy);
    const fx = cx - ix;
    const fy = cy - iy;

    const half = (TILE_SPAN - 1) / 2;
    const originCenterX = (0.5 - fx) * m;
    const originCenterZ = (0.5 - fy) * m;

    for (let oy = -half; oy <= half; oy++) {
      for (let ox = -half; ox <= half; ox++) {
        const tx = ix + ox;
        const ty = iy + oy;
        const cxw = originCenterX + ox * m;
        const czw = originCenterZ + oy * m;
        const tile = this._buildTile(tx, ty, cxw, czw, m);
        this._tiles.push(tile);
      }
    }

    const pin = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 2.0, 12),
      new THREE.MeshStandardMaterial({ color: 0xff3355, emissive: 0x441111 }),
    );
    pin.position.set(0, 1.0, 0);
    this.group.add(pin);
  }

  _buildTile(tx, ty, cxw, czw, m) {
    const geo = new THREE.PlaneGeometry(m, m, HEIGHT_SAMPLES - 1, HEIGHT_SAMPLES - 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc4c4c4, roughness: 0.95, metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cxw, 0, czw);
    mesh.receiveShadow = true;
    this.group.add(mesh);

    const tile = { mesh, geo, mat, cx: cxw, cz: czw, heights: null };

    this._loader.load(
      TILE_PROVIDERS.osm(ZOOM, tx, ty),
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        mat.map = tex;
        mat.needsUpdate = true;
      },
      undefined,
      () => {  },
    );

    fetch(TILE_PROVIDERS.terrariumPNG(ZOOM, tx, ty))
      .then(r => { if (!r.ok) throw new Error('terrarium ' + r.status); return r.blob(); })
      .then(blob => createImageBitmap(blob))
      .then(bmp => {
        const heights = decodeTerrarium(bmp, HEIGHT_SAMPLES);
        tile.heights = heights;

        if (this._heightOffset === 0) {

          let sum = 0;
          for (let i = 0; i < heights.length; i++) sum += heights[i];
          this._heightOffset = sum / heights.length;

          for (const t of this._tiles) if (t.heights) this._applyHeights(t);
        } else {
          this._applyHeights(tile);
        }
      })
      .catch(() => {  });

    return tile;
  }

  _applyHeights(tile) {
    const pos = tile.geo.attributes.position;
    const arr = pos.array;
    const N = HEIGHT_SAMPLES;

    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const idx = (iy * N + ix);
        const h = (tile.heights[idx] - this._heightOffset) * VERT_SCALE;
        arr[idx * 3 + 2] = h;
      }
    }
    pos.needsUpdate = true;
    tile.geo.computeVertexNormals();
  }
}
