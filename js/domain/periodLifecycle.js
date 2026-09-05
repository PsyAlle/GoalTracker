// periodLifecycle.js
// Owns the Period state machine:
//
//   (created)  -- planning (7d default, extendable) --> active (28d, logged)
//                                                            |
//                                                            v
//                                              closed  +  next period auto-created (planning)
//
// Design notes agreed with the user:
// - The very FIRST period ever has no predecessor to transition from, so the
//   user creates and starts it manually from an empty state.
// - Every subsequent period is created automatically, in 'planning' status,
//   the moment the previous active period's 28 days elapse.
// - A period in 'planning' flips to 'active' automatically after its
//   planning window (default 7 days) elapses, unless the user extended it.
// - There is deliberately no "start now" shortcut out of planning — only
//   "extend planning by N days" — per the user's decision.

import { store, newId } from "../db.js";
import { todayStr, addDays } from "./dates.js";

export const ACTIVE_DURATION_DAYS = 28;
export const DEFAULT_PLANNING_DURATION_DAYS = 7;

/**
 * Creates the very first period (empty state). Status starts as 'planning'
 * so the user goes through the same planning view (assessments, goal setup)
 * as any other transition — but this one is started manually.
 */
export async function createFirstPeriod() {
  const existing = await store.all("periods");
  if (existing.length > 0) throw new Error("Det finns redan perioder.");

  const today = todayStr();
  const period = {
    id: newId(),
    status: "planning",
    startDate: null,
    endDate: null,
    planningStartDate: today,
    planningEndDate: addDays(today, DEFAULT_PLANNING_DURATION_DAYS),
    periodFocus: { name: "", description: "", imageUrl: "", links: [] },
    createdAt: Date.now(),
  };
  await store.put("periods", period);
  return period;
}

/** Manually starts a 'planning' period that has no predecessor (first period only). */
export async function startFirstPeriodNow(periodId) {
  const period = await store.get("periods", periodId);
  if (!period || period.status !== "planning") return;
  const today = todayStr();
  period.startDate = today;
  period.endDate = addDays(today, ACTIVE_DURATION_DAYS - 1);
  period.status = "active";
  await store.put("periods", period);
  return period;
}

/** Extends a planning-status period's window by N days. */
export async function extendPlanning(periodId, extraDays) {
  const period = await store.get("periods", periodId);
  if (!period || period.status !== "planning") return;
  period.planningEndDate = addDays(period.planningEndDate, extraDays);
  await store.put("periods", period);
  return period;
}

/**
 * Call on every app load. Performs any due automatic transitions:
 *   active period past endDate       -> closed, next period auto-created (planning)
 *   planning period past planningEnd -> active
 * Loops in case multiple transitions are overdue (e.g. app unopened for a while).
 */
export async function runLifecycleCheck() {
  let changed = true;
  while (changed) {
    changed = false;
    const periods = await store.all("periods");
    const today = todayStr();

    const active = periods.find((p) => p.status === "active");
    if (active && today > active.endDate) {
      await closePeriodAndCreateNext(active);
      changed = true;
      continue;
    }

    // A 'planning' period only auto-advances to 'active' if it was created
    // automatically (has a predecessorId). The very first period is always
    // started manually — see wasAutoCreated() below.
    const autoPlanning = periods.find(
      (p) =>
        p.status === "planning" &&
        p.planningEndDate &&
        today > p.planningEndDate &&
        wasAutoCreated(p),
    );
    if (autoPlanning) {
      autoPlanning.status = "active";
      autoPlanning.startDate = addDays(autoPlanning.planningEndDate, 1);
      autoPlanning.endDate = addDays(
        autoPlanning.startDate,
        ACTIVE_DURATION_DAYS - 1,
      );
      await store.put("periods", autoPlanning);
      changed = true;
    }
  }
}

function wasAutoCreated(period) {
  // The first-ever period is created manually and must wait for the user's
  // explicit "starta period" action, not the automatic clock. We mark that
  // by the absence of a predecessorId.
  return !!period.predecessorId;
}

/**
 * Closes an active period and creates its successor in 'planning' status,
 * copying weekly/daily goal templates forward.
 */
async function closePeriodAndCreateNext(activePeriod) {
  activePeriod.status = "closed";
  await store.put("periods", activePeriod);

  const today = todayStr();
  const nextPeriod = {
    id: newId(),
    status: "planning",
    startDate: null,
    endDate: null,
    planningStartDate: today,
    planningEndDate: addDays(today, DEFAULT_PLANNING_DURATION_DAYS),
    periodFocus: { name: "", description: "", imageUrl: "", links: [] },
    predecessorId: activePeriod.id,
    createdAt: Date.now(),
  };
  await store.put("periods", nextPeriod);

  await copyGoalTemplates(activePeriod.id, nextPeriod.id);
  return nextPeriod;
}

/**
 * Copies the latest weekly/daily goal versions from the old period into
 * brand-new tracks+versions owned by the new period. This is a template
 * copy, not a shared reference — editing the new period's goals never
 * touches the frozen historical ones.
 */
async function copyGoalTemplates(fromPeriodId, toPeriodId) {
  const oldWeeklyTracks = await store.byIndex(
    "weeklyGoalTracks",
    "periodId",
    fromPeriodId,
  );
  for (const track of oldWeeklyTracks) {
    const versions = await store.byIndex(
      "weeklyGoalVersions",
      "trackId",
      track.id,
    );
    if (versions.length === 0) continue;
    const latest = versions.sort(
      (a, b) => b.effectiveFromWeek - a.effectiveFromWeek,
    )[0];

    const newTrackId = newId();
    await store.put("weeklyGoalTracks", {
      id: newTrackId,
      periodId: toPeriodId,
      createdAt: Date.now(),
    });
    await store.put("weeklyGoalVersions", {
      id: newId(),
      trackId: newTrackId,
      name: latest.name,
      targetValue: latest.targetValue,
      unit: latest.unit,
      description: latest.description,
      links: latest.links,
      effectiveFromWeek: 1,
      createdAt: Date.now(),
    });
  }

  const oldDailyTracks = await store.byIndex(
    "dailyGoalTracks",
    "periodId",
    fromPeriodId,
  );
  const newPeriod = await store.get("periods", toPeriodId);
  for (const track of oldDailyTracks) {
    const versions = await store.byIndex(
      "dailyGoalVersions",
      "trackId",
      track.id,
    );
    if (versions.length === 0) continue;
    const latest = versions.sort((a, b) =>
      a.effectiveFromDate < b.effectiveFromDate ? 1 : -1,
    )[0];

    const newTrackId = newId();
    await store.put("dailyGoalTracks", {
      id: newTrackId,
      periodId: toPeriodId,
      createdAt: Date.now(),
    });
    await store.put("dailyGoalVersions", {
      id: newId(),
      trackId: newTrackId,
      name: latest.name,
      targetValue: latest.targetValue,
      description: latest.description,
      links: latest.links,
      weekdays: latest.weekdays,
      effectiveFromDate: newPeriod.planningStartDate,
      createdAt: Date.now(),
    });
  }
}

/** Convenience: the single period currently in 'active' or 'planning' status, if any. */
export async function getCurrentPeriod() {
  const periods = await store.all("periods");
  return (
    periods.find((p) => p.status === "active" || p.status === "planning") ||
    null
  );
}

export async function getClosedPeriods() {
  const periods = await store.all("periods");
  return periods
    .filter((p) => p.status === "closed")
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** All periods (any status), oldest first. Periods are created strictly in
 *  sequence in this app (never branching), so creation order == time order. */
export async function getAllPeriodsChronological() {
  const periods = await store.all("periods");
  return periods.sort((a, b) => a.createdAt - b.createdAt);
}

/** The active or closed period whose active date-range contains dateStr, if any. */
export async function periodForDate(dateStr) {
  const periods = await store.all("periods");
  return (
    periods.find(
      (p) =>
        (p.status === "active" || p.status === "closed") &&
        p.startDate &&
        p.startDate <= dateStr &&
        dateStr <= p.endDate,
    ) || null
  );
}
