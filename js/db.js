// ============================================================
// RunQuest — persistance : IndexedDB (gros volumes) + localStorage (état)
// ============================================================

const DB_NAME = 'runquest';
const DB_VERSION = 1;
const LS_PREFIX = 'rq:';

// Stores IndexedDB :
//  activities : activités normalisées (toutes sources), clé = id
//  metrics    : métriques santé journalières, clé = [name, date]
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('activities')) {
        const s = db.createObjectStore('activities', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('metrics')) {
        db.createObjectStore('metrics', { keyPath: 'key' }); // key = `${name}|${date}`
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

async function idbPutAll(store, items) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const item of items) s.put(item);
    t.oncomplete = () => resolve(items.length);
    t.onerror = () => reject(t.error);
  });
}

async function idbGetAll(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = tx(db, store, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbClear(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = tx(db, store, 'readwrite').clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---- API activités ----

export async function saveActivities(activities) {
  return idbPutAll('activities', activities);
}

export async function getActivities() {
  const all = await idbGetAll('activities');
  return all.sort((a, b) => new Date(b.date) - new Date(a.date));
}

export async function deleteActivity(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'activities', 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteActivities(ids) {
  if (!ids.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('activities', 'readwrite');
    const s = t.objectStore('activities');
    for (const id of ids) s.delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// ---- API métriques santé ----
// metric = { key, name, date, ...values }

export async function saveMetrics(metrics) {
  return idbPutAll('metrics', metrics);
}

export async function getMetrics(name = null) {
  const all = await idbGetAll('metrics');
  const filtered = name ? all.filter(m => m.name === name) : all;
  return filtered.sort((a, b) => a.date.localeCompare(b.date));
}

// ---- État applicatif (localStorage) ----

export function getState(key, fallback = null) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function setState(key, value) {
  localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
}

export function removeState(key) {
  localStorage.removeItem(LS_PREFIX + key);
}

// Clés d'état utilisées :
//  settings   : { fcMax, fcRepos, poids, stravaClientId, stravaClientSecret, ... }
//  programs   : [ { ...programme, sessions avec statut } ]
//  gamification : { xp, badges: {id: dateISO}, history: [] }
//  strava     : { accessToken, refreshToken, expiresAt, athlete, lastSync }
//  importLog  : { santé/archive/api : date dernier import }

const STATE_KEYS = ['settings', 'programs', 'gamification', 'strava', 'importLog'];

// ---- Sauvegarde / restauration globale ----

export async function exportBackup() {
  const [activities, metrics] = await Promise.all([getActivities(), idbGetAll('metrics')]);
  const state = {};
  for (const k of STATE_KEYS) state[k] = getState(k);
  return {
    app: 'runquest',
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
    activities,
    metrics,
  };
}

export async function restoreBackup(data) {
  if (data?.app !== 'runquest') throw new Error('Fichier de sauvegarde non reconnu (attendu : export RunQuest)');
  await idbClear('activities');
  await idbClear('metrics');
  if (data.activities?.length) await idbPutAll('activities', data.activities);
  if (data.metrics?.length) await idbPutAll('metrics', data.metrics);
  for (const k of STATE_KEYS) {
    if (data.state && data.state[k] !== null && data.state[k] !== undefined) setState(k, data.state[k]);
    else removeState(k);
  }
  return { activities: data.activities?.length || 0, metrics: data.metrics?.length || 0 };
}

export async function wipeAll() {
  await idbClear('activities');
  await idbClear('metrics');
  for (const k of STATE_KEYS) removeState(k);
}
