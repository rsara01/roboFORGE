/**
 * Keeps imported robot packages in IndexedDB so a saved .json that uses an
 * imported robot can rebuild it later on the same browser without asking for
 * the zip again. Everything here is best-effort: private windows, full disks
 * and blocked storage just mean the package isn't remembered.
 */

const DB = 'roboforge-urdf';
const STORE = 'packages';

function open() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/** A short, stable key for a package: its URDF path, file count and total size. */
export function packageKey(vfs, urdfPath) {
  let bytes = 0;
  for (const b of vfs.files.values()) bytes += b.byteLength;
  return `${urdfPath}|${vfs.files.size}|${bytes}`;
}

export async function savePackage(key, vfs) {
  try {
    const db = await open();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ files: [...vfs.files.entries()], savedAt: Date.now() }, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
    return true;
  } catch (err) {
    console.warn('[RoboForge] Could not remember the robot package:', err);
    return false;
  }
}

/** @returns {Promise<[string, Uint8Array][] | null>} */
export async function loadPackage(key) {
  try {
    const db = await open();
    const row = await new Promise((res, rej) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    });
    db.close();
    return row?.files || null;
  } catch {
    return null;
  }
}
