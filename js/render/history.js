// history.js
import { el, mount, progressFigure } from './dom.js';
import { getClosedPeriods } from '../domain/periodLifecycle.js';
import { getWeeklyTracks, getWeeklyVersions, weeklyProgressValue, getDailyTracks, getDailyVersions, dailyProgressValue } from '../domain/goals.js';
import { getAllAssessmentsForPeriod } from '../domain/longTermGoals.js';
import { store } from '../db.js';
import { formatDateHuman, addDays, isoWeekday, WEEKDAY_LABELS } from '../domain/dates.js';

export async function renderHistoryPage(container) {
  const periods = await getClosedPeriods();
  const root = el('div');

  if (periods.length === 0) {
    root.appendChild(el('p.empty-state', { text: 'Inga avslutade perioder ännu.' }));
    mount(container, root);
    return;
  }

  root.appendChild(el('div.section-title', { text: 'AVSLUTADE PERIODER' }));
  for (const period of periods) {
    root.appendChild(
      el('button.history-period-row', {
        onClick: () => renderPeriodDetail(container, period),
      }, [
        el('div.h-dates', { text: `${formatDateHuman(period.startDate)} – ${formatDateHuman(period.endDate)}` }),
        el('div.h-name', { text: period.periodFocus?.name || '(inget periodfokus satt)' }),
      ])
    );
  }

  mount(container, root);
}

async function renderPeriodDetail(container, period) {
  const root = el('div');

  root.appendChild(
    el('button.back-link', { text: '← Tillbaka till historik', onClick: () => renderHistoryPage(container) })
  );

  root.appendChild(
    el('div.period-header', {}, [
      el('div.period-week', { text: `${formatDateHuman(period.startDate)} – ${formatDateHuman(period.endDate)}` }),
      el('h2', { text: period.periodFocus?.name || '(inget periodfokus satt)' }),
      period.periodFocus?.description ? el('p.period-desc', { text: period.periodFocus.description }) : null,
    ])
  );

  root.appendChild(await renderAssessmentsHistory(period));
  root.appendChild(await renderWeeklyHistory(period));
  root.appendChild(await renderDailyHistory(period));

  mount(container, root);
}

async function renderAssessmentsHistory(period) {
  const assessments = await getAllAssessmentsForPeriod(period.id);
  const section = el('div', {}, [el('div.section-title', { text: 'MÅLSKATTNINGAR' })]);
  if (assessments.length === 0) {
    section.appendChild(el('p', { text: 'Inga skattningar registrerade för denna period.', class: 'goal-meta' }));
    return section;
  }
  const ledger = el('div.ledger');
  for (const a of assessments) {
    const goal = await store.get('longTermGoals', a.goalId);
    ledger.appendChild(
      el('div.ledger-row', {}, [
        el('div.name', {}, [
          el('span.goal-name', { text: goal ? goal.name : '(borttaget mål)' }),
          a.note ? el('span.goal-meta', { text: a.note }) : null,
        ]),
        el('span.progress-figure', {}, [el('span.done.num', { text: `${a.score}/10` })]),
      ])
    );
  }
  section.appendChild(ledger);
  return section;
}

async function renderWeeklyHistory(period) {
  const tracks = await getWeeklyTracks(period.id);
  const section = el('div', {}, [el('div.section-title', { text: 'VECKOMÅL — HELA PERIODEN' })]);
  if (tracks.length === 0) {
    section.appendChild(el('p', { text: 'Inga veckomål registrerade.', class: 'goal-meta' }));
    return section;
  }

  for (const track of tracks) {
    const versions = await getWeeklyVersions(track.id);
    const block = el('div', { style: 'margin-bottom: 20px' });
    const firstVersion = versions[0];
    block.appendChild(el('div.goal-name', { text: firstVersion?.name || '(mål)' }));

    const ledger = el('div.ledger');
    for (let week = 1; week <= 4; week++) {
      const applicable = versions.filter((v) => v.effectiveFromWeek <= week);
      const version = applicable.length ? applicable[applicable.length - 1] : null;
      if (!version) continue;
      const value = await weeklyProgressValue(track.id, week);
      ledger.appendChild(
        el('div.ledger-row', {}, [
          el('div.name', { text: `Vecka ${week}` }),
          progressFigure(value, version.targetValue, version.unit),
        ])
      );
    }
    block.appendChild(ledger);
    section.appendChild(block);
  }
  return section;
}

async function renderDailyHistory(period) {
  const tracks = await getDailyTracks(period.id);
  const section = el('div', {}, [el('div.section-title', { text: 'DAGLIGA MÅL — SAMMANFATTNING' })]);
  if (tracks.length === 0) {
    section.appendChild(el('p', { text: 'Inga dagliga mål registrerade.', class: 'goal-meta' }));
    return section;
  }

  for (const track of tracks) {
    const versions = await getDailyVersions(track.id);
    const latest = versions[versions.length - 1];
    if (!latest) continue;

    let metCount = 0;
    let totalCount = 0;
    for (let i = 0; i < 28; i++) {
      const date = addDays(period.startDate, i);
      const applicable = versions.filter((v) => v.effectiveFromDate <= date);
      const version = applicable.length ? applicable[applicable.length - 1] : null;
      if (!version) continue;
      const isoWd = isoWeekday(date);
      if (!version.weekdays.includes(isoWd)) continue;
      totalCount++;
      const value = await dailyProgressValue(track.id, date);
      if (value >= version.targetValue) metCount++;
    }

    section.appendChild(
      el('div.ledger-row', {}, [
        el('div.name', {}, [
          el('span.goal-name', { text: latest.name }),
          el('span.goal-meta', { text: latest.weekdays.map((d) => WEEKDAY_LABELS[d]).join(', ') }),
        ]),
        el('span.progress-figure', {}, [
          el('span.done.num', { text: String(metCount) }),
          el('span.slash.num', { text: '/' }),
          el('span.target.num', { text: `${totalCount} dagar` }),
        ]),
      ])
    );
  }
  return section;
}
