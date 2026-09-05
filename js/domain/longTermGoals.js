// longTermGoals.js
// Long-term goals live outside the period/track versioning system: editing a
// goal's info (name/description/links) is a plain in-place update, but its
// assessment history (0-10 scores per period) is append-only and must never
// be rewritten by later edits to the goal itself.

import { store, newId } from "../db.js";

export async function getActiveLongTermGoals() {
  return store.byIndex("longTermGoals", "status", "active");
}

export async function getAllLongTermGoals() {
  return store.all("longTermGoals");
}

export async function addLongTermGoal({ name, description = "", links = [] }) {
  const goal = {
    id: newId(),
    name,
    description,
    links,
    status: "active",
    createdAt: Date.now(),
  };
  await store.put("longTermGoals", goal);
  return goal;
}

/** Editing info never touches past LongTermGoalAssessment rows. */
export async function editLongTermGoal(goalId, patch) {
  const goal = await store.get("longTermGoals", goalId);
  if (!goal) return;
  Object.assign(goal, patch);
  await store.put("longTermGoals", goal);
}

/** Archiving (never hard-delete) keeps assessment history intact and visible in History. */
export async function archiveLongTermGoal(goalId) {
  const goal = await store.get("longTermGoals", goalId);
  if (!goal) return;
  goal.status = "archived";
  await store.put("longTermGoals", goal);
}

export async function unarchiveLongTermGoal(goalId) {
  const goal = await store.get("longTermGoals", goalId);
  if (!goal) return;
  goal.status = "active";
  await store.put("longTermGoals", goal);
}

export async function getAssessments(goalId) {
  const rows = await store.byIndex("longTermGoalAssessments", "goalId", goalId);
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function latestAssessment(goalId) {
  const rows = await getAssessments(goalId);
  return rows.length ? rows[rows.length - 1] : null;
}

export async function getAssessmentForPeriod(goalId, periodId) {
  const rows = await store.byIndex(
    "longTermGoalAssessments",
    "periodId",
    periodId,
  );
  return rows.find((r) => r.goalId === goalId) || null;
}

/**
 * Records (or updates, if one already exists for this goal+period) the
 * single assessment tied to a planning period. Per the agreed model there is
 * exactly one score per goal per period — set any time during planning week.
 */
export async function setAssessment(goalId, periodId, score, note = "") {
  const existing = await getAssessmentForPeriod(goalId, periodId);
  const record = existing || {
    id: newId(),
    goalId,
    periodId,
    createdAt: Date.now(),
  };
  record.score = score;
  record.note = note;
  record.updatedAt = Date.now();
  await store.put("longTermGoalAssessments", record);
  return record;
}

export async function getAllAssessmentsForPeriod(periodId) {
  return store.byIndex("longTermGoalAssessments", "periodId", periodId);
}
