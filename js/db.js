// db.js
// Thin wrapper around native IndexedDB. No build step, no dependencies.
// Provides: connection/schema setup, generic CRUD per store, and a small
// pub/sub layer so UI code can react to writes without a framework.

const DB_NAME = 'loggboken';
const DB_VERSION = 2;

/** @type {IDBDatabase|null} */
let dbInstance = null;

/**
 * Opens (and if needed, creates/upgrades) the database.
 * Object stores mirror the domain model discussed with the user:
 *   periods, weeklyGoalTracks, weeklyGoalVersions, weeklyProgressEvents,
 *   dailyGoalTracks, dailyGoalVersions, dailyProgressEvents,
 *   longTermGoals, longTermGoalAssessments, meta
 */
export function openDb() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;

      if (!db.objectStoreNames.contains('periods')) {
        const s = db.createObjectStore('periods', { keyPath: 'id' });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('weeklyGoalTracks')) {
        const s = db.createObjectStore('weeklyGoalTracks', { keyPath: 'id' });
        s.createIndex('periodId', 'periodId', { unique: false });
      }

      if (!db.objectStoreNames.contains('weeklyGoalVersions')) {
        const s = db.createObjectStore('weeklyGoalVersions', { keyPath: 'id' });
        s.createIndex('trackId', 'trackId', { unique: false });
      }

      if (!db.objectStoreNames.contains('weeklyProgressEvents')) {
        const s = db.createObjectStore('weeklyProgressEvents', { keyPath: 'id' });
        s.createIndex('trackId', 'trackId', { unique: false });
        s.createIndex('trackId_week', ['trackId', 'weekNumber'], { unique: false });
      }

      if (!db.objectStoreNames.contains('dailyGoalTracks')) {
        const s = db.createObjectStore('dailyGoalTracks', { keyPath: 'id' });
        s.createIndex('periodId', 'periodId', { unique: false });
      }

      if (!db.objectStoreNames.contains('dailyGoalVersions')) {
        const s = db.createObjectStore('dailyGoalVersions', { keyPath: 'id' });
        s.createIndex('trackId', 'trackId', { unique: false });
      }

      if (!db.objectStoreNames.contains('dailyProgressEvents')) {
        const s = db.createObjectStore('dailyProgressEvents', { keyPath: 'id' });
        s.createIndex('trackId', 'trackId', { unique: false });
        s.createIndex('trackId_date', ['trackId', 'date'], { unique: false });
      }

      if (!db.objectStoreNames.contains('longTermGoals')) {
        const s = db.createObjectStore('longTermGoals', { keyPath: 'id' });
        s.createIndex('status', 'status', { unique: false });
      }

      if (!db.objectStoreNames.contains('longTermGoalAssessments')) {
        const s = db.createObjectStore('longTermGoalAssessments', { keyPath: 'id' });
        s.createIndex('goalId', 'goalId', { unique: false });
        s.createIndex('periodId', 'periodId', { unique: false });
      }

      if (!db.objectStoreNames.contains('sessionLogs')) {
        const s = db.createObjectStore('sessionLogs', { keyPath: 'id' });
        s.createIndex('periodId', 'periodId', { unique: false });
        s.createIndex('date', 'date', { unique: false });
      }

      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(storeNames, mode) {
  return openDb().then((db) => db.transaction(storeNames, mode));
}

/** Generic helpers, promise-wrapped. */
export const store = {
  /** @returns {Promise<any>} */
  async get(name, id) {
    const t = await tx(name, 'readonly');
    return new Promise((resolve, reject) => {
      const req = t.objectStore(name).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  /** @returns {Promise<any[]>} */
  async all(name) {
    const t = await tx(name, 'readonly');
    return new Promise((resolve, reject) => {
      const req = t.objectStore(name).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  /** @returns {Promise<any[]>} */
  async byIndex(name, indexName, value) {
    const t = await tx(name, 'readonly');
    return new Promise((resolve, reject) => {
      const idx = t.objectStore(name).index(indexName);
      const req = idx.getAll(value);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  /** Insert or replace a record; notifies subscribers of `name`. */
  async put(name, record) {
    const t = await tx(name, 'readwrite');
    await new Promise((resolve, reject) => {
      const req = t.objectStore(name).put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    notify(name);
    return record;
  },

  /** Insert or replace many records in one transaction. */
  async putMany(name, records) {
    const t = await tx(name, 'readwrite');
    const os = t.objectStore(name);
    await Promise.all(
      records.map(
        (r) =>
          new Promise((resolve, reject) => {
            const req = os.put(r);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          })
      )
    );
    notify(name);
    return records;
  },

  async delete(name, id) {
    const t = await tx(name, 'readwrite');
    await new Promise((resolve, reject) => {
      const req = t.objectStore(name).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    notify(name);
  },

  /** Wipes every record from a store. Used by "reset data". */
  async clear(name) {
    const t = await tx(name, 'readwrite');
    await new Promise((resolve, reject) => {
      const req = t.objectStore(name).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    notify(name);
  },
};

// --- Minimal reactivity: subscribe to a store name, get called after writes ---

/** @type {Map<string, Set<Function>>} */
const listeners = new Map();

export function subscribe(storeName, callback) {
  if (!listeners.has(storeName)) listeners.set(storeName, new Set());
  listeners.get(storeName).add(callback);
  return () => listeners.get(storeName)?.delete(callback);
}

function notify(storeName) {
  listeners.get(storeName)?.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.error('listener error for', storeName, err);
    }
  });
}

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for older WebViews without crypto.randomUUID
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export const ALL_STORES = [
  'periods',
  'weeklyGoalTracks',
  'weeklyGoalVersions',
  'weeklyProgressEvents',
  'dailyGoalTracks',
  'dailyGoalVersions',
  'dailyProgressEvents',
  'longTermGoals',
  'longTermGoalAssessments',
  'sessionLogs',
  'meta',
];
