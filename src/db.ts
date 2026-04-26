import type { ActivityFile } from './types.js';

const DB_NAME = 'gpx-timeline';
const DB_VERSION = 1;
const STORE = 'activities';

let _db: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => { _db = req.result; resolve(_db!); };
    req.onerror = () => reject(req.error);
  });
}

export function cacheKey(file: File): string {
  return `${file.name}:${file.lastModified}:${file.size}`;
}

export async function getManyCached(keys: string[]): Promise<Map<string, ActivityFile>> {
  if (keys.length === 0) return new Map();
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const result = new Map<string, ActivityFile>();
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    let pending = keys.length;
    for (const key of keys) {
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result) result.set(key, req.result);
        if (--pending === 0) resolve(result);
      };
      req.onerror = () => reject(req.error);
    }
  });
}

export async function putManyCached(entries: Array<[string, ActivityFile]>): Promise<void> {
  if (entries.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const [key, activity] of entries) store.put(activity, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
