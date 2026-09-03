// Persistence. IndexedDB when available, localStorage otherwise.
// Both back ends expose the same promise-based API, so nothing above
// this file needs to know which one is live.

const DB_NAME = 'gymplan';
const DB_VER = 1;
const STORES = ['sessions', 'meta'];

let backend = null;

function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'k' });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
    req.onblocked = () => rej(new Error('blocked'));
  });
}

function idbBackend(db) {
  const run = (store, mode, fn) => new Promise((res, rej) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.onerror = () => rej(tx.error);
    if (req) { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }
    else { tx.oncomplete = () => res(); }
  });
  return {
    kind: 'indexeddb',
    get: (store, key) => run(store, 'readonly', s => s.get(key)),
    put: (store, val) => run(store, 'readwrite', s => s.put(val)),
    del: (store, key) => run(store, 'readwrite', s => s.delete(key)),
    all: store => run(store, 'readonly', s => s.getAll()),
    clear: store => run(store, 'readwrite', s => s.clear()),
  };
}

// localStorage fallback: one JSON blob per store. Fine at this scale
// (a few hundred sessions is well under the 5 MB quota).
function lsBackend() {
  const read = store => {
    try { return JSON.parse(localStorage.getItem('gymplan:' + store) || '{}'); }
    catch (e) { return {}; }
  };
  const write = (store, obj) => {
    try { localStorage.setItem('gymplan:' + store, JSON.stringify(obj)); }
    catch (e) { console.warn('storage full', e); }
  };
  const keyOf = store => (store === 'sessions' ? 'id' : 'k');
  return {
    kind: 'localstorage',
    get: async (store, key) => read(store)[key],
    put: async (store, val) => { const o = read(store); o[val[keyOf(store)]] = val; write(store, o); },
    del: async (store, key) => { const o = read(store); delete o[key]; write(store, o); },
    all: async store => Object.values(read(store)),
    clear: async store => write(store, {}),
  };
}

async function be() {
  if (backend) return backend;
  try {
    if (!('indexedDB' in window)) throw new Error('no idb');
    backend = idbBackend(await idbOpen());
  } catch (e) {
    console.warn('IndexedDB unavailable, using localStorage:', e && e.message);
    backend = lsBackend();
  }
  return backend;
}

export async function storageKind() { return (await be()).kind; }

/* ---------- meta (small key/value settings) ---------- */

export async function getMeta(k, dflt = null) {
  const row = await (await be()).get('meta', k);
  return row === undefined || row === null ? dflt : row.v;
}
export async function setMeta(k, v) {
  await (await be()).put('meta', { k, v });
  return v;
}

/* ---------- sessions ---------- */

export const sessionId = (date, dayId) => date + '__' + dayId;

export async function getSession(id) {
  return (await (await be()).get('sessions', id)) || null;
}
export async function putSession(s) {
  s.updatedAt = new Date().toISOString();
  await (await be()).put('sessions', s);
  return s;
}
export async function deleteSession(id) {
  await (await be()).del('sessions', id);
}

// Newest first.
export async function allSessions() {
  const rows = await (await be()).all('sessions');
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// Only sessions with at least one completed set. An empty record gets
// created the moment you open a day, and those should not count as
// "I worked out" anywhere in History or Summary.
export async function loggedSessions() {
  return (await allSessions()).filter(hasWork);
}

export function hasWork(s) {
  return !!s && s.exercises.some(e => e.sets.some(x => x.done));
}

/* ---------- derived views ---------- */

// Every logged appearance of one exercise, newest first. This is what
// the per-exercise chart and the Summary tab read from.
export async function exerciseHistory(exId, limit = 0) {
  const out = [];
  for (const s of await loggedSessions()) {
    for (const e of s.exercises) {
      if (e.exId !== exId) continue;
      const done = e.sets.filter(x => x.done);
      if (!done.length) continue;
      out.push({
        date: s.date,
        dayName: s.dayName,
        sets: done,
        topWeight: Math.max(...done.map(x => +x.weight || 0)),
        totalReps: done.reduce((a, x) => a + (+x.reps || 0), 0),
        volume: done.reduce((a, x) => a + (+x.weight || 0) * (+x.reps || 0), 0),
        addWeightNextTime: !!e.addWeightNextTime,
      });
    }
  }
  return limit ? out.slice(0, limit) : out;
}

/* ---------- backup ---------- */

export async function exportAll() {
  const b = await be();
  return {
    format: 'gym-plan-history',
    version: 1,
    exportedAt: new Date().toISOString(),
    meta: await b.all('meta'),
    sessions: await b.all('sessions'),
  };
}

// Merge by default: a session already on this device wins only if it is
// newer, so importing an old backup never silently deletes recent work.
export async function importAll(data, { replace = false } = {}) {
  if (!data || data.format !== 'gym-plan-history') {
    throw new Error('Not a gym-plan backup file.');
  }
  const b = await be();
  if (replace) { await b.clear('sessions'); await b.clear('meta'); }

  let added = 0, updated = 0, skipped = 0;
  for (const s of data.sessions || []) {
    if (!s || !s.id) { skipped++; continue; }
    const cur = await b.get('sessions', s.id);
    if (!cur) { await b.put('sessions', s); added++; }
    else if (!cur.updatedAt || (s.updatedAt || '') > cur.updatedAt) { await b.put('sessions', s); updated++; }
    else skipped++;
  }
  for (const m of data.meta || []) {
    if (m && m.k && (replace || (await b.get('meta', m.k)) === undefined)) await b.put('meta', m);
  }
  return { added, updated, skipped };
}
