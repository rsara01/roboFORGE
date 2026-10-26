/**
 * A tiny in-memory file system for a dropped robot package.
 *
 * Whatever the user gives us (a .zip, a folder, or a pile of loose files) ends
 * up as one map of normalised path → bytes. URDF mesh references are then
 * resolved against it the way ROS would (package://, relative to the URDF,
 * file://), with fallbacks for the usual ways zips get packed wrong.
 */

import { unzipSync } from 'three/addons/libs/fflate.module.js';

const ROBOT_EXT = /\.(urdf|xacro)$/i;
const SKIP = /(^|\/)(__MACOSX|\.git)(\/|$)|(^|\/)\._|(^|\/)\.DS_Store$/;

/** Normalise a path: forward slashes, no leading ./ or /, '..' collapsed. */
export function normPath(p) {
  const out = [];
  for (const part of String(p).replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}

const dirOf = (p) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);

export class VFS {
  constructor() {
    /** @type {Map<string, Uint8Array>} */
    this.files = new Map();
    this._lower = new Map();     // lower-case path → real path
    this._urls = new Map();      // real path → blob: URL
  }

  add(path, bytes) {
    const p = normPath(path);
    if (!p || SKIP.test(p)) return;
    this.files.set(p, bytes);
    this._lower.set(p.toLowerCase(), p);
  }

  /** Unpack a zip into the file system. Nested zips are left alone. */
  addZip(bytes, prefix = '') {
    const entries = unzipSync(bytes);
    for (const [name, data] of Object.entries(entries)) {
      if (name.endsWith('/')) continue;            // directory entry
      this.add(prefix + name, data);
    }
  }

  /** Every URDF / xacro in the package, shallowest first. */
  robotFiles() {
    return [...this.files.keys()]
      .filter(p => ROBOT_EXT.test(p))
      .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  }

  text(path) {
    const b = this.files.get(path);
    return b ? new TextDecoder().decode(b) : null;
  }

  /** A blob: URL for a file in the package, made once and reused. */
  url(path) {
    let u = this._urls.get(path);
    if (!u) {
      u = URL.createObjectURL(new Blob([this.files.get(path)]));
      this._urls.set(path, u);
    }
    return u;
  }

  dispose() {
    for (const u of this._urls.values()) URL.revokeObjectURL(u);
    this._urls.clear();
  }

  /**
   * Find the file a URDF `filename` attribute points at.
   * @param {string} ref       the attribute, e.g. package://so_arm/meshes/base.stl
   * @param {string} fromFile  path of the URDF that contains it
   * @returns {string|null}    a path in this.files, or null
   */
  resolve(ref, fromFile = '') {
    if (!ref) return null;
    let r = ref.trim();
    let pkg = null;
    const m = /^(package|model):\/\/([^/]+)\/(.*)$/i.exec(r);
    if (m) { pkg = m[2]; r = m[3]; }
    else r = r.replace(/^file:\/\//i, '');
    r = normPath(r);

    const tries = [];
    if (pkg) {
      // The package folder is usually the URDF's own ancestor named `pkg`.
      const parts = dirOf(fromFile).split('/');
      const at = parts.lastIndexOf(pkg);
      if (at >= 0) tries.push(parts.slice(0, at + 1).join('/') + '/' + r);
      tries.push(pkg + '/' + r, r);
    } else {
      tries.push(normPath(dirOf(fromFile) + '/' + r), r);
    }
    for (const t of tries) {
      const hit = this.files.has(t) ? t : this._lower.get(t.toLowerCase());
      if (hit) return hit;
    }

    // Fallbacks: the longest trailing piece of the path that matches, then
    // just the file name. Absolute paths from someone's laptop land here.
    const segs = r.split('/');
    for (let i = 1; i < segs.length; i++) {
      const tail = '/' + segs.slice(i).join('/').toLowerCase();
      for (const [low, real] of this._lower) if (('/' + low).endsWith(tail)) return real;
    }
    return null;
  }

  /** Resolve a path relative to another file in the package (textures, .bin, .mtl). */
  relative(fromFile, rel) {
    const t = normPath(dirOf(fromFile) + '/' + decodeURIComponent(rel));
    return this.files.has(t) ? t : (this._lower.get(t.toLowerCase()) || this.resolve(rel, fromFile));
  }
}

/** Build a VFS from a FileList / File[] (zips are unpacked, folder paths kept). */
export async function vfsFromFiles(files) {
  const vfs = new VFS();
  for (const f of files) {
    const path = f.webkitRelativePath || f._path || f.name;
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) vfs.addZip(bytes, dirOf(normPath(path)) ? dirOf(normPath(path)) + '/' : '');
    else vfs.add(path, bytes);
  }
  return vfs;
}

/** Collect every File in a drag-and-drop, walking into dropped folders. */
export async function filesFromDrop(dataTransfer) {
  const entries = [...dataTransfer.items]
    .map(it => it.webkitGetAsEntry?.())
    .filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];

  const out = [];
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      file._path = prefix + file.name;
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries hands back at most ~100 at a time; keep asking until empty.
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, prefix + entry.name + '/');
      }
    }
  }
  for (const e of entries) await walk(e, '');
  return out;
}

export { baseOf, dirOf };
