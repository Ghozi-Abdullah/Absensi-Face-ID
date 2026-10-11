// Penyimpanan lokal di IndexedDB. Data wajah tidak pernah dikirim ke server.

const DB_NAME = 'hadir-db';
const DB_VERSION = 1;
let dbPromise = null;
let memory = null; // cadangan bila IndexedDB tidak tersedia (mis. mode privat)

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB tidak tersedia'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('people')) db.createObjectStore('people', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('logs')) {
        const logs = db.createObjectStore('logs', { keyPath: 'id' });
        logs.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    console.warn('Memakai penyimpanan sementara:', err);
    memory = { people: new Map(), logs: new Map(), settings: new Map() };
    return null;
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(store) {
  const db = await open();
  if (!db) return [...memory[store].values()];
  return tx(db, store, 'readonly', (s) => reqP(s.getAll()));
}

export async function put(store, value) {
  const db = await open();
  if (!db) { memory[store].set(value.id || value.key, value); return value; }
  await tx(db, store, 'readwrite', (s) => reqP(s.put(value)));
  return value;
}

export async function putMany(store, values) {
  const db = await open();
  if (!db) { values.forEach((v) => memory[store].set(v.id || v.key, v)); return; }
  await tx(db, store, 'readwrite', (s) => Promise.all(values.map((v) => reqP(s.put(v)))));
}

export async function remove(store, id) {
  const db = await open();
  if (!db) { memory[store].delete(id); return; }
  await tx(db, store, 'readwrite', (s) => reqP(s.delete(id)));
}

export async function clear(store) {
  const db = await open();
  if (!db) { memory[store].clear(); return; }
  await tx(db, store, 'readwrite', (s) => reqP(s.clear()));
}

export async function logsByDate(date) {
  const db = await open();
  if (!db) return [...memory.logs.values()].filter((l) => l.date === date);
  return tx(db, 'logs', 'readonly', (s) => reqP(s.index('date').getAll(date)));
}

export async function getSettings(defaults) {
  const rows = await getAll('settings');
  const out = { ...defaults };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function saveSettings(obj) {
  await putMany('settings', Object.entries(obj).map(([key, value]) => ({ key, value })));
}

export function isPersistent() {
  return memory === null;
}
