// dashboard.js
import { el, mount, toast, progressFigure, stepper, progressRing, openGoalDetailModal } from './dom.js';
import {
  getCurrentPeriod,
  createFirstPeriod,
  startFirstPeriodNow,
  extendPlanning,
} from '../domain/periodLifecycle.js';
import {
  dailyGoalsForDate,
  weeklyGoalsForWeek,
  logDailyProgress,
  logWeeklyProgress,
  weekNumberInPeriod,
  getWeeklyTracks,
  getWeeklyVersions,
  removeWeeklyGoal,
  getDailyTracks,
  getDailyVersions,
  removeDailyGoal,
} from '../domain/goals.js';
import { getActiveLongTermGoals, getAssessmentForPeriod, setAssessment, latestAssessment } from '../domain/longTermGoals.js';
import { openWeeklyGoalForm, openDailyGoalForm } from './goalForms.js';
import { store } from '../db.js';
import { todayStr, daysBetween, formatDateHuman, WEEKDAY_LABELS } from '../domain/dates.js';

export async function renderDashboard(container) {
  const period = await getCurrentPeriod();

  if (!period) {
    mount(container, renderEmptyState());
    return;
  }

  if (period.status === 'planning') {
    mount(container, await renderPlanningView(period));
  } else {
    mount(container, await renderActiveView(period));
  }
}

function renderEmptyState() {
  return el('div.empty-state', {}, [
    el('h2', { text: 'Ingen period ännu' }),
    el('p', { text: 'Skapa din första 4-veckorsperiod för att komma igång.' }),
    el('button.btn.primary', {
      text: 'Skapa första perioden',
      style: 'margin-top: 16px',
      onClick: async () => {
        await createFirstPeriod();
        refresh();
      },
    }),
  ]);
}

// ============================================================
// ACTIVE VIEW
// ============================================================

async function renderActiveView(period) {
  const today = todayStr();
  const currentWeek = weekNumberInPeriod(period.startDate, today) || 4;

  // Fetched once and reused by both the header (for the progress ring) and
  // the two goal blocks below, instead of each part re-querying the DB.
  const dailyGoals = await dailyGoalsForDate(period.id, today);
  const weeklyGoals = await weeklyGoalsForWeek(period.id, currentWeek);

  const root = el('div');
  root.appendChild(renderPeriodHeader(period, currentWeek, dailyGoals, weeklyGoals));
  root.appendChild(renderDailyGoalsBlock(dailyGoals, today));
  root.appendChild(renderWeeklyGoalsBlock(weeklyGoals, currentWeek));

  return root;
}

/** Combined completion (0-100) across today's daily goals + this week's weekly goals. */
function weekProgressPercent(dailyGoals, weeklyGoals) {
  const all = [...dailyGoals, ...weeklyGoals];
  const sumValue = all.reduce((s, g) => s + Math.min(g.value, g.version.targetValue), 0);
  const sumTarget = all.reduce((s, g) => s + g.version.targetValue, 0);
  if (sumTarget === 0) return 0;
  return Math.round((sumValue / sumTarget) * 100);
}

function renderPeriodHeader(period, currentWeek, dailyGoals, weeklyGoals) {
  const focus = period.periodFocus || {};
  const pct = weekProgressPercent(dailyGoals, weeklyGoals);
  return el('div.period-header', {}, [
    el('div', {}, [
      el('div.period-week', { text: `VECKA ${currentWeek}/4` }),
      el('h2', { text: focus.name || 'Periodfokus ej satt' }),
      focus.description ? el('p.period-desc', { text: focus.description }) : null,
      focus.links && focus.links.length
        ? el(
            'div.goal-meta',
            {},
            focus.links.map((l, i) => [
              i > 0 ? el('span', { text: '  ·  ' }) : null,
              el('a', { href: l.url, target: '_blank', rel: 'noopener', text: l.label || l.url }),
            ])
          )
        : null,
    ]),
    progressRing(pct, 'small'),
  ]);
}

function renderDailyGoalsBlock(goals, today) {
  const section = el('div', {}, [el('div.section-title', { text: 'DAGENS MÅL' })]);

  if (goals.length === 0) {
    section.appendChild(el('p', { text: 'Inga dagliga mål idag.', class: 'goal-meta' }));
    return section;
  }

  const ledger = el('div.ledger');
  for (const { track, version, value } of goals) {
    const row = el('div.ledger-row', {}, [
      el(
        'div.name.clickable',
        { onClick: () => openGoalDetailModal({ name: version.name, description: version.description, links: version.links }) },
        [el('span.goal-name', { text: version.name })]
      ),
      progressFigure(value, version.targetValue),
      stepper(async (delta) => {
        if (value + delta < 0) return;
        await logDailyProgress(track.id, today, delta);
        refresh();
      }, { disableMinus: value <= 0 }),
    ]);
    ledger.appendChild(row);
  }
  section.appendChild(ledger);
  return section;
}

function renderWeeklyGoalsBlock(goals, currentWeek) {
  const section = el('div', {}, [el('div.section-title', { text: 'VECKANS MÅL' })]);

  if (goals.length === 0) {
    section.appendChild(el('p', { text: 'Inga veckomål satta.', class: 'goal-meta' }));
    return section;
  }

  const ledger = el('div.ledger');
  for (const { track, version, value } of goals) {
    const row = el('div.ledger-row', {}, [
      el(
        'div.name.clickable',
        { onClick: () => openGoalDetailModal({ name: version.name, description: version.description, links: version.links }) },
        [el('span.goal-name', { text: version.name })]
      ),
      progressFigure(value, version.targetValue, version.unit),
      stepper(async (delta) => {
        if (value + delta < 0) return;
        await logWeeklyProgress(track.id, currentWeek, delta);
        refresh();
      }, { disableMinus: value <= 0 }),
    ]);
    ledger.appendChild(row);
  }
  section.appendChild(ledger);
  return section;
}

// ============================================================
// PLANNING VIEW
// ============================================================

async function renderPlanningView(period) {
  const root = el('div');
  const daysLeft = daysBetween(todayStr(), period.planningEndDate);

  root.appendChild(
    el('p.planning-banner', {}, [
      el('strong', { text: 'Planeringsvecka' }),
      el('span', {
        text: period.startDate === null && !period.predecessorId
          ? 'Fyll i nästa periods fokus och mål, tryck sedan Starta period när du är redo.'
          : `Nästa period startar automatiskt ${formatDateHuman(period.planningEndDate)} (om ${Math.max(daysLeft, 0)} dagar).`,
      }),
    ])
  );

  if (period.predecessorId || period.startDate !== null) {
    root.appendChild(
      el('button.btn', {
        text: '+ Förläng planering med 3 dagar',
        style: 'margin-bottom: 24px',
        onClick: async () => {
          await extendPlanning(period.id, 3);
          refresh();
        },
      })
    );
  }

  root.appendChild(await renderAssessmentSection(period));
  root.appendChild(renderPeriodFocusEditor(period));
  root.appendChild(await renderPlanningGoalsSection(period));

  if (!period.predecessorId) {
    root.appendChild(
      el('button.btn.primary.block', {
        text: 'Starta period',
        style: 'margin-top: 24px',
        onClick: async () => {
          await startFirstPeriodNow(period.id);
          toast('Perioden startad!');
          refresh();
        },
      })
    );
  }

  return root;
}

async function renderAssessmentSection(period) {
  const goals = await getActiveLongTermGoals();
  const section = el('div', {}, [el('div.section-title', { text: 'SKATTA LÅNGSIKTIGA MÅL' })]);

  if (goals.length === 0) {
    section.appendChild(el('p', { text: 'Inga aktiva långsiktiga mål att skatta.', class: 'goal-meta' }));
    return section;
  }

  for (const goal of goals) {
    const existing = await getAssessmentForPeriod(goal.id, period.id);
    const previous = await latestAssessment(goal.id);
    const startValue = existing ? existing.score : previous ? previous.score : 5;

    const readout = el('div.score-readout', { text: String(startValue) });
    const slider = el('input', {
      type: 'range',
      min: '0',
      max: '10',
      step: '1',
      value: String(startValue),
      oninput: (e) => {
        readout.textContent = e.target.value;
      },
    });
    const noteInput = el('textarea', { placeholder: 'Anteckning (valfritt)', value: existing?.note || '' });
    const saveBtn = el('button.btn', {
      text: 'Spara skattning',
      onClick: async () => {
        await setAssessment(goal.id, period.id, Number(slider.value), noteInput.value.trim());
        toast('Skattning sparad.');
      },
    });

    section.appendChild(
      el('div.slider-block', {}, [
        el('div.goal-name', { text: goal.name }),
        previous
          ? el('div.previous-score', { text: `Senast skattat: ${previous.score}/10` })
          : el('div.previous-score', { text: 'Ingen tidigare skattning.' }),
        readout,
        slider,
        el('div.field', { style: 'margin-top: 8px' }, [noteInput]),
        saveBtn,
      ])
    );
  }
  return section;
}

function renderPeriodFocusEditor(period) {
  const focus = period.periodFocus || { name: '', description: '', imageUrl: '', links: [] };
  const nameInput = el('input', { type: 'text', value: focus.name, placeholder: 'T.ex. Träna mot muscle-up' });
  const descInput = el('textarea', { value: focus.description, placeholder: 'Beskrivning (valfritt)' });

  const save = async () => {
    period.periodFocus = { ...focus, name: nameInput.value.trim(), description: descInput.value.trim() };
    await store.put('periods', period);
  };

  nameInput.addEventListener('blur', save);
  descInput.addEventListener('blur', save);

  return el('div', {}, [
    el('div.section-title', { text: 'PERIODFOKUS' }),
    el('div.field', {}, [el('label', { text: 'Namn' }), nameInput]),
    el('div.field', {}, [el('label', { text: 'Beskrivning' }), descInput]),
  ]);
}

async function renderPlanningGoalsSection(period) {
  const section = el('div');

  section.appendChild(el('div.section-title', { text: 'VECKOMÅL FÖR KOMMANDE PERIOD' }));
  section.appendChild(
    el('button.btn.block', {
      text: '+ Nytt veckomål',
      onClick: () => openWeeklyGoalForm({ periodId: period.id, currentWeek: 1, onSaved: refresh }),
    })
  );
  const weeklyTracks = await getWeeklyTracks(period.id);
  const wList = el('div', { style: 'margin-top: 12px' });
  for (const track of weeklyTracks) {
    const versions = await getWeeklyVersions(track.id);
    const latest = versions[versions.length - 1];
    if (!latest) continue;
    wList.appendChild(
      el('div.goal-card', {}, [
        el('div.goal-card-top', {}, [el('div.goal-name', { text: `${latest.name} — ${latest.targetValue} ${latest.unit}` })]),
        el('div.goal-card-actions', {}, [
          el('button', {
            text: 'Redigera',
            onClick: () =>
              openWeeklyGoalForm({ periodId: period.id, currentWeek: 1, track, existingVersion: latest, onSaved: refresh }),
          }),
          el('button', {
            text: 'Ta bort',
            onClick: async () => {
              await removeWeeklyGoal(track.id);
              refresh();
            },
          }),
        ]),
      ])
    );
  }
  section.appendChild(wList);

  section.appendChild(el('div.section-title', { text: 'DAGLIGA MÅL FÖR KOMMANDE PERIOD' }));
  section.appendChild(
    el('button.btn.block', {
      text: '+ Nytt dagligt mål',
      onClick: () =>
        openDailyGoalForm({ periodId: period.id, fromDate: period.planningStartDate, onSaved: refresh }),
    })
  );
  const dailyTracks = await getDailyTracks(period.id);
  const dList = el('div', { style: 'margin-top: 12px' });
  for (const track of dailyTracks) {
    const versions = await getDailyVersions(track.id);
    const latest = versions[versions.length - 1];
    if (!latest) continue;
    const dayLabels = latest.weekdays.map((d) => WEEKDAY_LABELS[d]).join(', ');
    dList.appendChild(
      el('div.goal-card', {}, [
        el('div.goal-card-top', {}, [
          el('div', {}, [
            el('div.goal-name', { text: `${latest.name} — ${latest.targetValue}/dag` }),
            el('div.goal-meta', { text: dayLabels }),
          ]),
        ]),
        el('div.goal-card-actions', {}, [
          el('button', {
            text: 'Redigera',
            onClick: () =>
              openDailyGoalForm({
                periodId: period.id,
                fromDate: period.planningStartDate,
                track,
                existingVersion: latest,
                onSaved: refresh,
              }),
          }),
          el('button', {
            text: 'Ta bort',
            onClick: async () => {
              await removeDailyGoal(track.id);
              refresh();
            },
          }),
        ]),
      ])
    );
  }
  section.appendChild(dList);

  return section;
}

function refresh() {
  const container = document.querySelector('#view-container');
  if (container) renderDashboard(container);
}
