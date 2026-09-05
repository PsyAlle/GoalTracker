// exportImport.js
// Export: a single JSON file containing every store's full contents, plus a
// schemaVersion so future app versions can migrate old exports if the
// on-disk model ever changes shape.
//
// Import: replaces all local data with the contents of a chosen export file.
// This is a destructive restore (by design — it's meant for moving to a new
// device or recovering from a backup), so the caller must confirm with the
// user before invoking it.

import { store, ALL_STORES } from "../db.js";

export const SCHEMA_VERSION = 1;

export async function exportAllData() {
  const data = {};
  for (const name of ALL_STORES) {
    data[name] = await store.all(name);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function downloadExport(exportObject) {
  const blob = new Blob([JSON.stringify(exportObject, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = exportObject.exportedAt.slice(0, 10);
  a.href = url;
  a.download = `loggboken-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Wipes all local stores and replaces them with the contents of a parsed
 * export object. Throws if the file doesn't look like a valid export.
 */
export async function importAllData(parsed) {
  if (!parsed || typeof parsed !== "object" || !parsed.data) {
    throw new Error("Filen ser inte ut som en giltig backup.");
  }
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Backupen har en okänd version (${parsed.schemaVersion}). Kan inte importera.`,
    );
  }
  for (const name of ALL_STORES) {
    await store.clear(name);
    const rows = parsed.data[name];
    if (Array.isArray(rows) && rows.length) {
      await store.putMany(name, rows);
    }
  }
}

export async function resetAllData() {
  for (const name of ALL_STORES) {
    await store.clear(name);
  }
}

export function readFileAsJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (err) {
        reject(new Error("Filen kunde inte tolkas som JSON."));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
