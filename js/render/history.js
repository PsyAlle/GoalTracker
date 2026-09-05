// history.js
import { el, mount, progressFigure } from "./dom.js";
import { getClosedPeriods } from "../domain/periodLifecycle.js";
import {
  getWeeklyTracks,
  getWeeklyVersions,
  weeklyVersionForWeek,
  weeklyProgressValue,
  getDailyTracks,
  getDailyVersions,
  dailyGoalsForDate,
  dailyProgressValue,
} from "../domain/goals.js";
import { getAllAssessmentsForPeriod } from "../domain/longTermGoals.js";
import {
  getSessionLogsForPeriod,
  deleteSessionLog,
  resolveGoalRefName,
} from "../domain/sessionLogs.js";
import { store } from "../db.js";
import {
  formatDateHuman,
  addDays,
  isoWeekday,
  WEEKDAY_LABELS,
} from "../domain/dates.js";

export async function renderHistoryPage(container) {
  const periods = await getClosedPeriods();
  const root = el("div");

  if (periods.length === 0) {
    root.appendChild(
      el("p.empty-state", { text: "Inga avslutade perioder ännu." }),
    );
    mount(container, root);
    return;
  }

  root.appendChild(el("div.section-title", { text: "AVSLUTADE PERIODER" }));
  for (const period of periods) {
    root.appendChild(
      el(
        "button.history-period-row",
        {
          onClick: () => renderPeriodDetail(container, period),
        },
        [
          el("div.h-dates", {
            text: `${formatDateHuman(period.startDate)} – ${formatDateHuman(period.endDate)}`,
          }),
          el("div.h-name", {
            text: period.periodFocus?.name || "(inget periodfokus satt)",
          }),
        ],
      ),
    );
  }

  mount(container, root);
}

async function renderPeriodDetail(container, period) {
  const root = el("div");

  root.appendChild(
    el("button.back-link", {
      text: "← Tillbaka till historik",
      onClick: () => renderHistoryPage(container),
    }),
  );

  root.appendChild(
    el("div.period-header", {}, [
      el("div.period-week", {
        text: `${formatDateHuman(period.startDate)} – ${formatDateHuman(period.endDate)}`,
      }),
      el("h2", {
        text: period.periodFocus?.name || "(inget periodfokus satt)",
      }),
      period.periodFocus?.description
        ? el("p.period-desc", { text: period.periodFocus.description })
        : null,
    ]),
  );

  root.appendChild(await renderDayGridSection(period));
  root.appendChild(await renderAssessmentsHistory(period));
  root.appendChild(await renderWeeklyHistory(period));
  root.appendChild(await renderDailyHistory(period));
  root.appendChild(await renderSessionLogsHistory(period, container));

  mount(container, root);
}

/**
 * A 7-column grid, one row per week (4 rows / up to 28 cells), showing:
 *  - green cell: every applicable daily goal was met that day
 *  - empty/hairline cell: at least one applicable daily goal was missed
 *  - dashed/neutral cell: weekend, or no daily goals applied that day
 * Each week's row gets a moss-colored border if every weekly goal for that
 * week was fully met (only decorated when the period actually had weekly
 * goals — a period with none doesn't get a false "complete" border).
 */
async function renderDayGridSection(period) {
  const section = el("div", {}, [
    el("div.section-title", { text: "DAGAR I PERIODEN" }),
  ]);

  const weeklyTracks = await getWeeklyTracks(period.id);
  const grid = el("div.day-grid-weeks");

  for (let week = 1; week <= 4; week++) {
    let weekComplete = false;
    if (weeklyTracks.length > 0) {
      let anyApplicable = false;
      let allMet = true;
      for (const track of weeklyTracks) {
        const version = await weeklyVersionForWeek(track.id, week);
        if (!version) continue;
        anyApplicable = true;
        const value = await weeklyProgressValue(track.id, week);
        if (value < version.targetValue) allMet = false;
      }
      weekComplete = anyApplicable && allMet;
    }

    const weekRow = el("div.day-grid-week", {
      class: weekComplete ? "day-grid-week week-complete" : "day-grid-week",
    });

    const weekStart = addDays(period.startDate, (week - 1) * 7);
    for (let i = 0; i < 7; i++) {
      const date = addDays(weekStart, i);
      if (date > period.endDate) break;

      const wd = isoWeekday(date);
      let cellClass = "day-cell";
      if (wd === 6 || wd === 7) {
        cellClass += " weekend";
      } else {
        const dayGoals = await dailyGoalsForDate(period.id, date);
        if (dayGoals.length === 0) {
          cellClass += " no-goals";
        } else if (dayGoals.every((g) => g.value >= g.version.targetValue)) {
          cellClass += " complete";
        }
      }
      weekRow.appendChild(
        el("div", { class: cellClass, title: formatDateHuman(date) }),
      );
    }
    grid.appendChild(weekRow);
  }

  section.appendChild(grid);
  return section;
}

async function renderSessionLogsHistory(period, container) {
  const logs = await getSessionLogsForPeriod(period.id);
  const section = el("div", {}, [
    el("div.section-title", { text: "PASSLOGGAR" }),
  ]);
  if (logs.length === 0) {
    section.appendChild(
      el("p", {
        text: "Inga loggar registrerade för denna period.",
        class: "goal-meta",
      }),
    );
    return section;
  }

  for (const log of logs) {
    const goalName = await resolveGoalRefName(log.goalRef);
    const expanded = expandedLogIds.has(log.id);

    const card = el("div.goal-card", {}, [
      el(
        "div.goal-card-top",
        {
          class: "goal-card-top clickable",
          onClick: () => {
            if (expanded) expandedLogIds.delete(log.id);
            else expandedLogIds.add(log.id);
            renderPeriodDetail(container, period);
          },
        },
        [
          el("div", {}, [
            el("div.goal-name", { text: formatDateHuman(log.date) }),
            el("div.goal-meta", { text: goalName || "Inget mål kopplat" }),
          ]),
          el("button.goal-chevron", { text: expanded ? "▴" : "▾" }),
        ],
      ),
      expanded
        ? el("div", { style: "margin-top: var(--space-2)" }, [
            el("p.goal-meta", {
              text: `Readiness ${log.readiness}/10 · RPE ${log.rpe}/10`,
            }),
            log.note
              ? el("p", { text: log.note, style: "margin: 4px 0 0" })
              : null,
          ])
        : null,
      el("div.goal-card-actions", {}, [
        el("button", {
          text: "Ta bort",
          onClick: async (e) => {
            e.stopPropagation();
            await deleteSessionLog(log.id);
            renderPeriodDetail(container, period);
          },
        }),
      ]),
    ]);
    section.appendChild(card);
  }
  return section;
}

// Tracks which session-log cards have been manually expanded, keyed by log
// id. Module-level so it survives the full re-render that follows every
// expand/collapse/delete in this view.
const expandedLogIds = new Set();

async function renderAssessmentsHistory(period) {
  const assessments = await getAllAssessmentsForPeriod(period.id);
  const section = el("div", {}, [
    el("div.section-title", { text: "MÅLSKATTNINGAR" }),
  ]);
  if (assessments.length === 0) {
    section.appendChild(
      el("p", {
        text: "Inga skattningar registrerade för denna period.",
        class: "goal-meta",
      }),
    );
    return section;
  }
  const ledger = el("div.ledger");
  for (const a of assessments) {
    const goal = await store.get("longTermGoals", a.goalId);
    ledger.appendChild(
      el("div.ledger-row", {}, [
        el("div.name", {}, [
          el("span.goal-name", { text: goal ? goal.name : "(borttaget mål)" }),
          a.note ? el("span.goal-meta", { text: a.note }) : null,
        ]),
        el("span.progress-figure", {}, [
          el("span.done.num", { text: `${a.score}/10` }),
        ]),
      ]),
    );
  }
  section.appendChild(ledger);
  return section;
}

async function renderWeeklyHistory(period) {
  const tracks = await getWeeklyTracks(period.id);
  const section = el("div", {}, [
    el("div.section-title", { text: "VECKOMÅL — HELA PERIODEN" }),
  ]);
  if (tracks.length === 0) {
    section.appendChild(
      el("p", { text: "Inga veckomål registrerade.", class: "goal-meta" }),
    );
    return section;
  }

  for (const track of tracks) {
    const versions = await getWeeklyVersions(track.id);
    const block = el("div", { style: "margin-bottom: 20px" });
    const firstVersion = versions[0];
    block.appendChild(
      el("div.goal-name", { text: firstVersion?.name || "(mål)" }),
    );

    const ledger = el("div.ledger");
    for (let week = 1; week <= 4; week++) {
      const applicable = versions.filter((v) => v.effectiveFromWeek <= week);
      const version = applicable.length
        ? applicable[applicable.length - 1]
        : null;
      if (!version) continue;
      const value = await weeklyProgressValue(track.id, week);
      ledger.appendChild(
        el("div.ledger-row", {}, [
          el("div.name", { text: `Vecka ${week}` }),
          progressFigure(value, version.targetValue, version.unit),
        ]),
      );
    }
    block.appendChild(ledger);
    section.appendChild(block);
  }
  return section;
}

async function renderDailyHistory(period) {
  const tracks = await getDailyTracks(period.id);
  const section = el("div", {}, [
    el("div.section-title", { text: "DAGLIGA MÅL — SAMMANFATTNING" }),
  ]);
  if (tracks.length === 0) {
    section.appendChild(
      el("p", { text: "Inga dagliga mål registrerade.", class: "goal-meta" }),
    );
    return section;
  }

  const ledger = el("div.ledger");
  for (const track of tracks) {
    const versions = await getDailyVersions(track.id);
    const latest = versions[versions.length - 1];
    if (!latest) continue;

    let metCount = 0;
    let totalCount = 0;
    for (let i = 0; i < 28; i++) {
      const date = addDays(period.startDate, i);
      const applicable = versions.filter((v) => v.effectiveFromDate <= date);
      const version = applicable.length
        ? applicable[applicable.length - 1]
        : null;
      if (!version) continue;
      const isoWd = isoWeekday(date);
      if (!version.weekdays.includes(isoWd)) continue;
      totalCount++;
      const value = await dailyProgressValue(track.id, date);
      if (value >= version.targetValue) metCount++;
    }

    ledger.appendChild(
      el("div.ledger-row", {}, [
        el("div.name", {}, [
          el("span.goal-name", { text: latest.name }),
          el("span.goal-meta", {
            text: latest.weekdays.map((d) => WEEKDAY_LABELS[d]).join(", "),
          }),
        ]),
        el("span.progress-figure", {}, [
          el("span.done.num", { text: String(metCount) }),
          el("span.slash.num", { text: "/" }),
          el("span.target.num", { text: `${totalCount} dagar` }),
        ]),
      ]),
    );
  }
  section.appendChild(ledger);
  return section;
}
