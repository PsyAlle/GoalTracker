// sessionLogs.js
// A session log is a free-standing per-day note: readiness (0-10), RPE (0-10),
// and free text, optionally tied to a goal. The goal reference is entirely
// optional — the app must save and display logs correctly whether or not a
// goal is attached — so `goalRef` is either null or { kind, id }, where
// `kind` is 'weekly' | 'daily' | 'longterm'.

import { store, newId } from "../db.js";

/**
 * @param {string} periodId
 * @param {string} dateStr YYYY-MM-DD, the day the log applies to
 * @param {object} fields
 * @param {{kind: 'weekly'|'daily'|'longterm', id: string}|null} fields.goalRef
 * @param {number} fields.readiness 0-10
 * @param {number} fields.rpe 0-10
 * @param {string} fields.note
 */
export async function addSessionLog(
  periodId,
  dateStr,
  { goalRef = null, readiness, rpe, note = "" },
) {
  const log = {
    id: newId(),
    periodId,
    date: dateStr,
    goalRef,
    readiness,
    rpe,
    note,
    createdAt: Date.now(),
  };
  await store.put("sessionLogs", log);
  return log;
}

export async function getSessionLogsForPeriod(periodId) {
  const logs = await store.byIndex("sessionLogs", "periodId", periodId);
  return logs.sort((a, b) =>
    a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? 1 : -1,
  );
}

export async function deleteSessionLog(logId) {
  await store.delete("sessionLogs", logId);
}

/**
 * Resolves a goalRef to a display name, looking in whichever store it points
 * to. Returns null if goalRef is null or the referenced goal no longer
 * exists (e.g. it was deleted after the log was made) — callers should treat
 * a null result the same as "no goal attached".
 */
export async function resolveGoalRefName(goalRef) {
  if (!goalRef) return null;
  if (goalRef.kind === "weekly") {
    const versions = await store.byIndex(
      "weeklyGoalVersions",
      "trackId",
      goalRef.id,
    );
    if (!versions.length) return null;
    return versions
      .sort((a, b) => a.effectiveFromWeek - b.effectiveFromWeek)
      .pop().name;
  }
  if (goalRef.kind === "daily") {
    const versions = await store.byIndex(
      "dailyGoalVersions",
      "trackId",
      goalRef.id,
    );
    if (!versions.length) return null;
    return versions
      .sort((a, b) => (a.effectiveFromDate < b.effectiveFromDate ? -1 : 1))
      .pop().name;
  }
  if (goalRef.kind === "longterm") {
    const goal = await store.get("longTermGoals", goalRef.id);
    return goal ? goal.name : null;
  }
  return null;
}

/** Builds the flat list of {kind, id, label} options for the goal dropdown, for a given period. */
export async function getGoalRefOptions(periodId) {
  const options = [];

  const weeklyTracks = await store.byIndex(
    "weeklyGoalTracks",
    "periodId",
    periodId,
  );
  for (const track of weeklyTracks) {
    const versions = await store.byIndex(
      "weeklyGoalVersions",
      "trackId",
      track.id,
    );
    if (!versions.length) continue;
    const latest = versions
      .sort((a, b) => a.effectiveFromWeek - b.effectiveFromWeek)
      .pop();
    options.push({
      kind: "weekly",
      id: track.id,
      label: `${latest.name} (veckomål)`,
    });
  }

  const dailyTracks = await store.byIndex(
    "dailyGoalTracks",
    "periodId",
    periodId,
  );
  for (const track of dailyTracks) {
    const versions = await store.byIndex(
      "dailyGoalVersions",
      "trackId",
      track.id,
    );
    if (!versions.length) continue;
    const latest = versions
      .sort((a, b) => (a.effectiveFromDate < b.effectiveFromDate ? -1 : 1))
      .pop();
    options.push({
      kind: "daily",
      id: track.id,
      label: `${latest.name} (dagligt mål)`,
    });
  }

  const longTermGoals = await store.byIndex(
    "longTermGoals",
    "status",
    "active",
  );
  for (const goal of longTermGoals) {
    options.push({
      kind: "longterm",
      id: goal.id,
      label: `${goal.name} (långsiktigt mål)`,
    });
  }

  return options;
}
