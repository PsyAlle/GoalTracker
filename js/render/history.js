// history.js
import { el, mount, progressFigure, accordionRow } from "./dom.js";
import { getClosedPeriods } from "../domain/periodLifecycle.js";
import {
  getWeeklyTracks,
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
  root.appendChild(await renderSessionLogsHistory(period, container));
  root.appendChild(await renderWeeklyByWeekSection(period, container));
  root.appendChild(await renderDailyHistory(period));
  root.appendChild(await renderAssessmentsHistory(period, container));

  mount(container, root);
}

/**
 * A compact 7-column grid, one row per week, next to a small stats block:
 *  - green cell: every applicable daily goal was met that day, OR the day
 *    had no applicable daily goals at all (weekend, rest day, etc.) — a day
 *    with nothing scheduled counts the same as a day fully cleared.
 *  - plain hairline cell: at least one applicable daily goal was missed.
 * Each week's row gets a moss-colored border if every weekly goal for that
 * week was fully met (only decorated when the period actually had weekly
 * goals — a period with none doesn't get a false "complete" border).
 * The stats block reuses the same data to show days/weeks/logs totals.
 */
async function renderDayGridSection(period) {
  const section = el("div", {}, [
    el("div.section-title", { text: "DAGAR I PERIODEN" }),
  ]);

  const weeklyTracks = await getWeeklyTracks(period.id);
  const grid = el("div.day-grid-weeks");

  let weeksCompleteCount = 0;
  let weeksApplicableCount = 0;
  let daysMet = 0;
  let daysWithGoals = 0;

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
      if (anyApplicable) {
        weeksApplicableCount++;
        if (allMet) weeksCompleteCount++;
      }
    }

    const weekRow = el("div.day-grid-week", {
      class: weekComplete ? "day-grid-week week-complete" : "day-grid-week",
    });

    const weekStart = addDays(period.startDate, (week - 1) * 7);
    for (let i = 0; i < 7; i++) {
      const date = addDays(weekStart, i);
      if (date > period.endDate) break;

      const dayGoals = await dailyGoalsForDate(period.id, date);
      let cellClass = "day-cell";
      if (dayGoals.length === 0) {
        cellClass += " complete";
      } else {
        daysWithGoals++;
        if (dayGoals.every((g) => g.value >= g.version.targetValue)) {
          cellClass += " complete";
          daysMet++;
        }
      }
      weekRow.appendChild(
        el("div", { class: cellClass, title: formatDateHuman(date) }),
      );
    }
    grid.appendChild(weekRow);
  }

  const logs = await getSessionLogsForPeriod(period.id);

  const stats = el("div.day-grid-stats", {}, [
    el("div.stat-item", {}, [
      el("div.stat-value", {
        text: daysWithGoals > 0 ? `${daysMet}/${daysWithGoals}` : "–",
      }),
      el("div.stat-label", { text: "dagar med alla dagliga mål klara" }),
    ]),
    el("div.stat-item", {}, [
      el("div.stat-value", {
        text:
          weeksApplicableCount > 0
            ? `${weeksCompleteCount}/${weeksApplicableCount}`
            : "–",
      }),
      el("div.stat-label", { text: "veckor med alla veckomål klara" }),
    ]),
    el("div.stat-item", {}, [
      el("div.stat-value", { text: String(logs.length) }),
      el("div.stat-label", { text: "loggade pass" }),
    ]),
  ]);

  section.appendChild(el("div.day-grid-row", {}, [grid, stats]));
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

// Tracks which "Vecka N" rows are expanded, keyed by `${periodId}-${week}`
// so state doesn't leak between different periods that happen to share week
// numbers. Several weeks can be open at once (same pattern as the session
// log cards above).
const expandedWeekIds = new Set();

/**
 * Weekly goals grouped by week (Vecka 1–4) instead of by track: each week is
 * a collapsible row, showing a moss checkmark if every weekly goal for that
 * week was met. Expanding a week reveals the per-goal breakdown for it.
 */
async function renderWeeklyByWeekSection(period, container) {
  const tracks = await getWeeklyTracks(period.id);
  const section = el("div", {}, [
    el("div.section-title", { text: "VECKOMÅL" }),
  ]);
  if (tracks.length === 0) {
    section.appendChild(
      el("p", { text: "Inga veckomål registrerade.", class: "goal-meta" }),
    );
    return section;
  }

  const list = el("div.accordion-list");
  let anyWeek = false;

  for (let week = 1; week <= 4; week++) {
    const rows = [];
    let allMet = true;
    let anyApplicable = false;

    for (const track of tracks) {
      const version = await weeklyVersionForWeek(track.id, week);
      if (!version) continue;
      anyApplicable = true;
      const value = await weeklyProgressValue(track.id, week);
      if (value < version.targetValue) allMet = false;
      rows.push({
        name: version.name,
        value,
        target: version.targetValue,
        unit: version.unit,
      });
    }

    if (!anyApplicable) continue;
    anyWeek = true;

    const stateKey = `${period.id}-${week}`;
    const expanded = expandedWeekIds.has(stateKey);

    const body = el("div.ledger");
    for (const r of rows) {
      body.appendChild(
        el("div.ledger-row", {}, [
          el("div.name", { text: r.name }),
          progressFigure(r.value, r.target, r.unit),
        ]),
      );
    }

    list.appendChild(
      accordionRow({
        title: `Vecka ${week}`,
        complete: allMet,
        expanded,
        onToggle: () => {
          if (expanded) expandedWeekIds.delete(stateKey);
          else expandedWeekIds.add(stateKey);
          renderPeriodDetail(container, period);
        },
        body,
      }),
    );
  }

  if (!anyWeek) {
    section.appendChild(
      el("p", { text: "Inga veckomål registrerade.", class: "goal-meta" }),
    );
    return section;
  }

  section.appendChild(list);
  return section;
}

// Tracks whether the "Målskattningar" card is expanded, keyed by period id.
const expandedAssessmentsIds = new Set();

async function renderAssessmentsHistory(period, container) {
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

  const expanded = expandedAssessmentsIds.has(period.id);
  const list = el("div.accordion-list", {}, [
    accordionRow({
      title: `${assessments.length} skattningar`,
      expanded,
      onToggle: () => {
        if (expanded) expandedAssessmentsIds.delete(period.id);
        else expandedAssessmentsIds.add(period.id);
        renderPeriodDetail(container, period);
      },
      body: ledger,
    }),
  ]);
  section.appendChild(list);
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
