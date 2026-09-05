// goals.js
// Weekly and daily goals are each split into:
//   Track    — the stable identity of "this goal, within this period"
//   Version  — a snapshot of name/target/description/links, timestamped
//              with the week (weekly) or date (daily) it takes effect from
//   Event    — an append-only +1/-1 log; never updated or deleted in place
//
// This means editing a goal never rewrites history: past weeks/days keep
// reading whichever version was effective at the time, and past progress
// events are untouched.

import { store, newId } from '../db.js';
import { weekNumberInPeriod, isoWeekday } from './dates.js';

// ---------- Weekly goals ----------

export async function getWeeklyTracks(periodId) {
  return store.byIndex('weeklyGoalTracks', 'periodId', periodId);
}

export async function getWeeklyVersions(trackId) {
  const versions = await store.byIndex('weeklyGoalVersions', 'trackId', trackId);
  // IndexedDB returns rows in primary-key (random UUID) order, not creation
  // order, so two versions sharing the same effectiveFromWeek (e.g. editing
  // the same goal twice in one sitting) need createdAt as a tie-breaker —
  // otherwise "latest version" (versions[versions.length - 1]) could
  // unpredictably pick the older edit instead of the newer one.
  return versions.sort(
    (a, b) => a.effectiveFromWeek - b.effectiveFromWeek || a.createdAt - b.createdAt,
  );
}

/** The version of a weekly goal that was/is effective for a given week number (1-4). */
export async function weeklyVersionForWeek(trackId, weekNumber) {
  const versions = await getWeeklyVersions(trackId);
  const applicable = versions.filter((v) => v.effectiveFromWeek <= weekNumber);
  return applicable.length ? applicable[applicable.length - 1] : null;
}

/** Creates a brand new weekly goal track + its first version. */
export async function addWeeklyGoal(periodId, { name, targetValue, unit, description = '', links = [] }, fromWeek = 1) {
  const trackId = newId();
  await store.put('weeklyGoalTracks', { id: trackId, periodId, createdAt: Date.now() });
  await store.put('weeklyGoalVersions', {
    id: newId(),
    trackId,
    name,
    targetValue,
    unit,
    description,
    links,
    effectiveFromWeek: fromWeek,
    createdAt: Date.now(),
  });
  return trackId;
}

/**
 * Edits a weekly goal from a given week forward. Earlier weeks keep reading
 * the older version untouched — this is a NEW version row, not a mutation.
 */
export async function editWeeklyGoal(trackId, patch, fromWeek) {
  const current = await weeklyVersionForWeek(trackId, fromWeek);
  const base = current || {};
  await store.put('weeklyGoalVersions', {
    id: newId(),
    trackId,
    name: patch.name ?? base.name,
    targetValue: patch.targetValue ?? base.targetValue,
    unit: patch.unit ?? base.unit,
    description: patch.description ?? base.description ?? '',
    links: patch.links ?? base.links ?? [],
    effectiveFromWeek: fromWeek,
    createdAt: Date.now(),
  });
}

/** Removes a weekly goal from the active period entirely (only meaningful for the current period). */
export async function removeWeeklyGoal(trackId) {
  await store.delete('weeklyGoalTracks', trackId);
  const versions = await store.byIndex('weeklyGoalVersions', 'trackId', trackId);
  for (const v of versions) await store.delete('weeklyGoalVersions', v.id);
  const events = await store.byIndex('weeklyProgressEvents', 'trackId', trackId);
  for (const e of events) await store.delete('weeklyProgressEvents', e.id);
}

export async function logWeeklyProgress(trackId, weekNumber, delta) {
  await store.put('weeklyProgressEvents', {
    id: newId(),
    trackId,
    weekNumber,
    delta,
    timestamp: Date.now(),
  });
}

/** Current summed progress for a track in a given week. */
export async function weeklyProgressValue(trackId, weekNumber) {
  const events = await store.byIndex('weeklyProgressEvents', 'trackId_week', [trackId, weekNumber]);
  return events.reduce((sum, e) => sum + e.delta, 0);
}

// ---------- Daily goals ----------

export async function getDailyTracks(periodId) {
  return store.byIndex('dailyGoalTracks', 'periodId', periodId);
}

export async function getDailyVersions(trackId) {
  const versions = await store.byIndex('dailyGoalVersions', 'trackId', trackId);
  // Same fix as getWeeklyVersions: IndexedDB row order isn't creation order,
  // and the old comparator never returned 0 for equal dates (breaking sort
  // stability), so two edits made on the same day could end up in the wrong
  // order and hide the newer one. Compare dates properly, then createdAt.
  return versions.sort((a, b) => {
    if (a.effectiveFromDate < b.effectiveFromDate) return -1;
    if (a.effectiveFromDate > b.effectiveFromDate) return 1;
    return a.createdAt - b.createdAt;
  });
}

/** The version of a daily goal effective on a given date (YYYY-MM-DD). */
export async function dailyVersionForDate(trackId, dateStr) {
  const versions = await getDailyVersions(trackId);
  const applicable = versions.filter((v) => v.effectiveFromDate <= dateStr);
  return applicable.length ? applicable[applicable.length - 1] : null;
}

export async function addDailyGoal(
  periodId,
  { name, targetValue = 5, description = '', links = [], weekdays = [1, 2, 3, 4, 5] },
  fromDate
) {
  const trackId = newId();
  await store.put('dailyGoalTracks', { id: trackId, periodId, createdAt: Date.now() });
  await store.put('dailyGoalVersions', {
    id: newId(),
    trackId,
    name,
    targetValue,
    description,
    links,
    weekdays,
    effectiveFromDate: fromDate,
    createdAt: Date.now(),
  });
  return trackId;
}

/** Daily goals can be edited freely at any time; the new version takes effect from `fromDate` forward. */
export async function editDailyGoal(trackId, patch, fromDate) {
  const current = await dailyVersionForDate(trackId, fromDate);
  const base = current || {};
  await store.put('dailyGoalVersions', {
    id: newId(),
    trackId,
    name: patch.name ?? base.name,
    targetValue: patch.targetValue ?? base.targetValue,
    description: patch.description ?? base.description ?? '',
    links: patch.links ?? base.links ?? [],
    weekdays: patch.weekdays ?? base.weekdays ?? [1, 2, 3, 4, 5],
    effectiveFromDate: fromDate,
    createdAt: Date.now(),
  });
}

export async function removeDailyGoal(trackId) {
  await store.delete('dailyGoalTracks', trackId);
  const versions = await store.byIndex('dailyGoalVersions', 'trackId', trackId);
  for (const v of versions) await store.delete('dailyGoalVersions', v.id);
  const events = await store.byIndex('dailyProgressEvents', 'trackId', trackId);
  for (const e of events) await store.delete('dailyProgressEvents', e.id);
}

export async function logDailyProgress(trackId, dateStr, delta) {
  await store.put('dailyProgressEvents', {
    id: newId(),
    trackId,
    date: dateStr,
    delta,
    timestamp: Date.now(),
  });
}

export async function dailyProgressValue(trackId, dateStr) {
  const events = await store.byIndex('dailyProgressEvents', 'trackId_date', [trackId, dateStr]);
  return events.reduce((sum, e) => sum + e.delta, 0);
}

/**
 * All daily tracks that apply on a given date (goal's weekdays include that
 * date's ISO weekday), each with its effective version and current progress.
 * Returns [] on weekends — daily goals never apply then.
 */
export async function dailyGoalsForDate(periodId, dateStr) {
  const wd = isoWeekday(dateStr);
  if (wd === 6 || wd === 7) return [];

  const tracks = await getDailyTracks(periodId);
  const results = [];
  for (const track of tracks) {
    const version = await dailyVersionForDate(track.id, dateStr);
    if (!version) continue;
    if (!version.weekdays.includes(wd)) continue;
    const value = await dailyProgressValue(track.id, dateStr);
    results.push({ track, version, value });
  }
  return results;
}

/** All weekly tracks for the active period's current week, each with effective version + progress. */
export async function weeklyGoalsForWeek(periodId, weekNumber) {
  const tracks = await getWeeklyTracks(periodId);
  const results = [];
  for (const track of tracks) {
    const version = await weeklyVersionForWeek(track.id, weekNumber);
    if (!version) continue;
    const value = await weeklyProgressValue(track.id, weekNumber);
    results.push({ track, version, value });
  }
  return results;
}

export { weekNumberInPeriod };
