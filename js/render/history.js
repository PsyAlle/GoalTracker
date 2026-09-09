// history.js
import { el, mount, progressFigure, accordionRow, openModal } from "./dom.js";
import {
  getClosedPeriods,
  getCurrentPeriod,
} from "../domain/periodLifecycle.js";
import {
  getWeeklyTracks,
  weeklyVersionForWeek,
  weeklyProgressValue,
  weeklyGoalsForWeek,
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
  todayStr,
  formatDateHuman,
  addDays,
  isoWeekday,
  WEEKDAY_LABELS,
} from "../domain/dates.js";

/**
 * Top level: the active period (if any) is shown expanded immediately —
 * no click required — since it's the one you actually care about day to
 * day. Closed periods are listed below it, each opening its own detail
 * view (with a back-link) when tapped.
 */
export async function renderHistoryPage(container) {
  const closedPeriods = await getClosedPeriods();
  const current = await getCurrentPeriod();
  const activePeriod = current && current.status === "active" ? current : null;

  if (!activePeriod && closedPeriods.length === 0) {
    mount(container, el("p.empty-state", { text: "Inga perioder ännu." }));
    return;
  }

  const root = el("div");

  if (activePeriod) {
    root.appendChild(renderPeriodHeaderBlock(activePeriod));
    root.appendChild(await renderPeriodSections(activePeriod, container));
  }

  if (closedPeriods.length > 0) {
    root.appendChild(el("div.section-title", { text: "TIDIGARE PERIODER" }));
    for (const period of closedPeriods) {
      root.appendChild(
        el(
          "button.history-period-row",
          { onClick: () => renderClosedPeriodDetail(container, period) },
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
  }

  mount(container, root);
}

async function renderClosedPeriodDetail(container, period) {
  const root = el("div");
  root.appendChild(
    el("button.back-link", {
      text: "← Tillbaka till historik",
      onClick: () => renderHistoryPage(container),
    }),
  );
  root.appendChild(renderPeriodHeaderBlock(period));
  root.appendChild(await renderPeriodSections(period, container));
  mount(container, root);
}

function renderPeriodHeaderBlock(period) {
  const isActive = period.status === "active";
  return el("div.period-header", {}, [
    el("div.period-week", {
      text: isActive
        ? `Pågående sedan ${formatDateHuman(period.startDate)}`
        : `${formatDateHuman(period.startDate)} – ${formatDateHuman(period.endDate)}`,
    }),
    el("h2", {
      text: period.periodFocus?.name || "(inget periodfokus satt)",
    }),
    period.periodFocus?.description
      ? el("p.period-desc", { text: period.periodFocus.description })
      : null,
  ]);
}

async function renderPeriodSections(period, container) {
  const root = el("div");
  root.appendChild(await renderDayGridSection(period));
  root.appendChild(await renderSessionLogsHistory(period, container));
  root.appendChild(await renderWeeklyByWeekSection(period, container));
  root.appendChild(await renderDailyHistory(period));
  root.appendChild(await renderAssessmentsHistory(period, container));
  return root;
}

/**
 * A compact 7-column grid, one row per week, next to a small stats block,
 * covering the FULL 4-week period regardless of how much has happened yet:
 *  - green cell: every applicable daily goal was met that day, OR the day
 *    had no applicable daily goals at all (weekend, rest day, etc.).
 *  - plain hairline cell: at least one applicable daily goal was missed.
 *  - blank/transparent cell: date is still in the future (only relevant for
 *    the active period — closed periods never have future days). Future
 *    days are shown neutrally rather than as "missed", and are excluded
 *    from both the day and week stats below — this is what lets the grid
 *    for an active period fill in with green day by day rather than
 *    starting "wrong" and correcting itself.
 * Each week's row gets a moss-colored border if every weekly goal for that
 * week was fully met (only decorated when the period actually had weekly
 * goals). Tapping any cell opens that day's daily-goal breakdown together
 * with the weekly goals for the week it belongs to.
 */
async function renderDayGridSection(period) {
  const section = el("div", {}, [
    el("div.section-title", { text: "DAGAR I PERIODEN" }),
  ]);

  const today = todayStr();
  const weeklyTracks = await getWeeklyTracks(period.id);
  const grid = el("div.day-grid-weeks");

  let weeksCompleteCount = 0;
  let weeksApplicableCount = 0;
  let daysMet = 0;
  let daysWithGoals = 0;

  for (let week = 1; week <= 4; week++) {
    const weekStart = addDays(period.startDate, (week - 1) * 7);
    const rawWeekEnd = addDays(weekStart, 6);
    const weekEnd = rawWeekEnd > period.endDate ? period.endDate : rawWeekEnd;
    const weekHasElapsed = weekEnd <= today;

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
      if (anyApplicable && weekHasElapsed) {
        weeksApplicableCount++;
        if (allMet) weeksCompleteCount++;
      }
    }

    const weekRow = el("div.day-grid-week", {
      class: weekComplete ? "day-grid-week week-complete" : "day-grid-week",
    });

    for (let i = 0; i < 7; i++) {
      const date = addDays(weekStart, i);
      if (date > period.endDate) break;

      let cellClass = "day-cell";
      if (date > today) {
        cellClass += " future";
      } else {
        const dayGoals = await dailyGoalsForDate(period.id, date);
        if (dayGoals.length === 0) {
          cellClass += " complete";
        } else {
          daysWithGoals++;
          if (dayGoals.every((g) => g.value >= g.version.targetValue)) {
            cellClass += " complete";
            daysMet++;
          }
        }
      }

      const cellDate = date;
      const cellWeek = week;
      weekRow.appendChild(
        el("div", {
          class: cellClass,
          title: formatDateHuman(cellDate),
          onClick: () => openDayDetailModal(period, cellDate, cellWeek),
        }),
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

/**
 * Bottom-sheet showing a single day's daily-goal progress together with
 * the weekly goals for the week that day falls in. Read-only — this is
 * history, editing happens from Dashboard/Mål while a period is live.
 */
async function openDayDetailModal(period, dateStr, weekNumber) {
  const [dailyGoals, weeklyGoals] = await Promise.all([
    dailyGoalsForDate(period.id, dateStr),
    weeklyGoalsForWeek(period.id, weekNumber),
  ]);

  openModal((close) => {
    const children = [
      el("div.modal-close-bar"),
      el("h2", { text: formatDateHuman(dateStr) }),
    ];

    children.push(
      el("div.section-title", { text: "DAGENS MÅL", style: "margin-top: 0" }),
    );
    if (dailyGoals.length === 0) {
      children.push(el("p.goal-meta", { text: "Inga dagliga mål denna dag." }));
    } else {
      const ledger = el("div.ledger");
      for (const { version, value } of dailyGoals) {
        ledger.appendChild(
          el("div.ledger-row", {}, [
            el("div.name", { text: version.name }),
            progressFigure(value, version.targetValue),
          ]),
        );
      }
      children.push(ledger);
    }

    children.push(
      el("div.section-title", { text: `VECKA ${weekNumber} — VECKOMÅL` }),
    );
    if (weeklyGoals.length === 0) {
      children.push(
        el("p.goal-meta", { text: "Inga veckomål den här veckan." }),
      );
    } else {
      const ledger = el("div.ledger");
      for (const { version, value } of weeklyGoals) {
        ledger.appendChild(
          el("div.ledger-row", {}, [
            el("div.name", { text: version.name }),
            progressFigure(value, version.targetValue, version.unit),
          ]),
        );
      }
      children.push(ledger);
    }

    children.push(
      el("div.modal-actions", {}, [
        el("button.btn.block", { text: "Stäng", onClick: close }),
      ]),
    );

    return el("div", {}, children);
  });
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
            rerenderPeriod(container, period);
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
            rerenderPeriod(container, period);
          },
        }),
      ]),
    ]);
    section.appendChild(card);
  }
  return section;
}

/**
 * Re-renders whichever view `period` belongs in: the top-level History page
 * if it's the active period (since that's shown inline there), or its own
 * closed-period detail view otherwise.
 */
function rerenderPeriod(container, period) {
  if (period.status === "active") {
    renderHistoryPage(container);
  } else {
    renderClosedPeriodDetail(container, period);
  }
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
 * Weeks that haven't started yet (relevant only for the active period) are
 * skipped entirely rather than shown as an unmet 0/target row.
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

  const today = todayStr();
  const list = el("div.accordion-list");
  let anyWeek = false;

  for (let week = 1; week <= 4; week++) {
    const weekStart = addDays(period.startDate, (week - 1) * 7);
    if (weekStart > today) continue; // week hasn't started yet

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
          rerenderPeriod(container, period);
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
        rerenderPeriod(container, period);
      },
      body: ledger,
    }),
  ]);
  section.appendChild(list);
  return section;
}

/**
 * Summary of each daily goal's hit rate across the period. For the active
 * period this only counts days up to and including today — days that
 * haven't happened yet would otherwise silently drag the ratio down.
 */
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

  const today = todayStr();
  const ledger = el("div.ledger");
  for (const track of tracks) {
    const versions = await getDailyVersions(track.id);
    const latest = versions[versions.length - 1];
    if (!latest) continue;

    let metCount = 0;
    let totalCount = 0;
    for (let i = 0; i < 28; i++) {
      const date = addDays(period.startDate, i);
      if (date > period.endDate) break;
      if (date > today) break; // hasn't happened yet
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
