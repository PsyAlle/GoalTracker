// periodLifecycle.js
// Owns the Period state machine:
//
//   (created)  -- Deload-vecka (7d default, extendable) --> active (28d, logged)
//                                                                |
//                                                                v
//                                              closed  +  next period auto-created (Deload-vecka)
//
// Design notes agreed with the user:
// - The very FIRST period ever has no predecessor to transition from, so the
//   user creates and starts it manually from an empty state.
// - Every subsequent period is created automatically, in Deload-vecka
//   status, the moment the previous active period's 28 days elapse.
// - A period in Deload-vecka flips to 'active' automatically once
//   planningEndDate arrives, unless the user extended it.
// - Active periods always run Monday-Sunday (exactly 4 calendar weeks), so
//   weekly goals align to real calendar weeks instead of a rolling window.
//   To achieve this, `planningEndDate` is ALWAYS kept Monday-aligned at the
//   moment it's set (default duration, manual extension, or the first
//   period's manual start) rather than adjusted later at the transition —
//   this is what avoids the Deload-vecka silently ballooning by up to 6
//   extra days on every single cycle (see nextMonday() in dates.js).

import { store, newId } from "../db.js";
import { todayStr, addDays, isoWeekday, nextMonday } from "./dates.js";

export const ACTIVE_DURATION_DAYS = 28;
export const DEFAULT_PLANNING_DURATION_DAYS = 7;

/**
 * Creates the very first period (empty state). Status starts as 'planning'
 * (Deload-vecka) so the user goes through the same planning view
 * (assessments, goal setup) as any other transition — but this one is
 * started manually.
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

/**
 * Manually starts a 'planning' period that has no predecessor (first period
 * only). If today is already a Monday, starts immediately. Otherwise the
 * period keeps waiting (still 'planning') until the coming Monday, and
 * `pendingAutoStart` tells runLifecycleCheck to flip it to active then even
 * though it has no predecessorId — normally only auto-created periods do
 * that automatically.
 */
export async function startFirstPeriodNow(periodId) {
  const period = await store.get("periods", periodId);
  if (!period || period.status !== "planning") return;
  const today = todayStr();

  if (isoWeekday(today) === 1) {
    period.startDate = today;
    period.endDate = addDays(today, ACTIVE_DURATION_DAYS - 1);
    period.status = "active";
  } else {
    period.planningEndDate = nextMonday(today);
    period.pendingAutoStart = true;
  }

  await store.put("periods", period);
  return period;
}

/**
 * Extends a planning-status period's window by N days, then re-aligns to
 * the next Monday on/after that — so a manual extension can only push the
 * start later, never earlier, and the Monday-alignment invariant on
 * planningEndDate is never broken by an extension.
 */
export async function extendPlanning(periodId, extraDays) {
  const period = await store.get("periods", periodId);
  if (!period || period.status !== "planning") return;
  period.planningEndDate = nextMonday(addDays(period.planningEndDate, extraDays));
  await store.put("periods", period);
  return period;
}

/**
 * Call on every app load. Performs any due automatic transitions:
 *   active period past endDate              -> closed, next period auto-created (Deload-vecka)
 *   Deload-vecka period reaching planningEnd -> active
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

    // A 'planning' (Deload-vecka) period only auto-advances to 'active' if
    // it was created automatically (has a predecessorId) OR the user
    // already triggered the first period's manual start and it's just
    // waiting for the coming Monday (pendingAutoStart).
    const autoPlanning = periods.find(
      (p) =>
        p.status === "planning" &&
        p.planningEndDate &&
        today >= p.planningEndDate &&
        wasAutoCreated(p),
    );
    if (autoPlanning) {
      // planningEndDate is always kept Monday-aligned at the moment it's
      // set (see createFirstPeriod/closePeriodAndCreateNext/extendPlanning/
      // startFirstPeriodNow), so it can be used directly as the start date
      // with no further adjustment.
      const start = autoPlanning.planningEndDate;
      autoPlanning.status = "active";
      autoPlanning.startDate = start;
      autoPlanning.endDate = addDays(start, ACTIVE_DURATION_DAYS - 1);
      delete autoPlanning.pendingAutoStart;
      await store.put("periods", autoPlanning);
      changed = true;
    }
  }
}

function wasAutoCreated(period) {
  // Auto-created periods (has a predecessorId) always auto-transition.
  // The very first period only auto-transitions once the user has already
  // clicked "Starta period" and it's simply waiting for the coming Monday.
  return !!period.predecessorId || !!period.pendingAutoStart;
}

/**
 * Closes an active period and creates its successor in 'planning'
 * (Deload-vecka) status, copying weekly/daily goal templates forward.
 */
async function closePeriodAndCreateNext(activePeriod) {
  activePeriod.status = "closed";
  await store.put("periods", activePeriod);

  const today = todayStr();

  // One-time correction: if the period that just closed didn't itself
  // start on a Monday (e.g. it predates the calendar-week alignment fix),
  // target the NEAREST Monday instead of waiting a further 7 days — so
  // this one Deload-vecka is as short as possible rather than stretched.
  // Every period created from here on always starts on a Monday, so this
  // branch can only ever fire once; every later transition automatically
  // falls into the normal 7-day-then-ceiling case below.
  const startedOnMonday = isoWeekday(activePeriod.startDate) === 1;
  const planningEndDate = startedOnMonday
    ? nextMonday(addDays(today, DEFAULT_PLANNING_DURATION_DAYS))
    : nextMonday(today);

  const nextPeriod = {
    id: newId(),
    status: "planning",
    startDate: null,
    endDate: null,
    planningStartDate: today,
    planningEndDate,
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
