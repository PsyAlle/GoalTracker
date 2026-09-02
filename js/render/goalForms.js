// goalForms.js
// Modal forms shared between the Mål-page (goalsPage.js) and the planning
// view inside Dashboard. Kept separate from both so neither has to import
// the other.

import { el, openModal, linksEditor, weekdayPicker, toast } from './dom.js';
import { addWeeklyGoal, editWeeklyGoal } from '../domain/goals.js';
import { addDailyGoal, editDailyGoal } from '../domain/goals.js';
import { addLongTermGoal, editLongTermGoal } from '../domain/longTermGoals.js';

/**
 * Opens a form to add or edit a weekly goal.
 * @param {object} opts
 * @param {string} opts.periodId
 * @param {number} opts.currentWeek - the week number edits take effect from
 * @param {object} [opts.track] - {id} if editing, omit if adding
 * @param {object} [opts.existingVersion] - the version to prefill from
 * @param {Function} opts.onSaved
 */
export function openWeeklyGoalForm({ periodId, currentWeek, track, existingVersion, onSaved }) {
  const links = existingVersion ? [...existingVersion.links] : [];

  openModal((close) => {
    const nameInput = el('input', { type: 'text', value: existingVersion?.name || '', placeholder: 'T.ex. Moonboard' });
    const targetInput = el('input', { type: 'number', min: '1', value: String(existingVersion?.targetValue ?? 3) });
    const unitInput = el('input', { type: 'text', value: existingVersion?.unit || 'pass', placeholder: 'pass, set, ...' });
    const descInput = el('textarea', { value: existingVersion?.description || '', placeholder: 'Beskrivning / anteckningar (valfritt)' });

    const form = el('div', {}, [
      el('h2', { text: track ? 'Redigera veckomål' : 'Nytt veckomål' }),
      track
        ? el('p', {
            text: `Ändringen gäller från vecka ${currentWeek} och framåt. Tidigare veckor påverkas inte.`,
            class: 'planning-banner',
          })
        : null,
      el('div.field', {}, [el('label', { text: 'Namn' }), nameInput]),
      el('div.field-row', {}, [
        el('div.field', {}, [el('label', { text: 'Målvärde' }), targetInput]),
        el('div.field', {}, [el('label', { text: 'Enhet' }), unitInput]),
      ]),
      el('div.field', {}, [el('label', { text: 'Beskrivning' }), descInput]),
      el('div.field', {}, [el('label', { text: 'Länkar' }), linksEditor(links, () => {})]),
      el('div.modal-actions', {}, [
        el('button.btn.primary.block', {
          text: 'Spara',
          onClick: async () => {
            const name = nameInput.value.trim();
            const targetValue = Number(targetInput.value);
            if (!name || !targetValue || targetValue <= 0) {
              toast('Fyll i namn och ett målvärde större än 0.');
              return;
            }
            const payload = { name, targetValue, unit: unitInput.value.trim(), description: descInput.value.trim(), links };
            if (track) {
              await editWeeklyGoal(track.id, payload, currentWeek);
            } else {
              await addWeeklyGoal(periodId, payload, currentWeek);
            }
            close();
            onSaved?.();
          },
        }),
        el('button.btn.block', { text: 'Avbryt', onClick: close }),
      ]),
    ]);
    return form;
  });
}

/**
 * Opens a form to add or edit a daily goal. Daily goals can be edited freely
 * at any time — the new version simply takes effect from `fromDate`.
 */
export function openDailyGoalForm({ periodId, fromDate, track, existingVersion, onSaved }) {
  const links = existingVersion ? [...existingVersion.links] : [];
  const weekdays = existingVersion ? [...existingVersion.weekdays] : [1, 2, 3, 4, 5];

  openModal((close) => {
    const nameInput = el('input', { type: 'text', value: existingVersion?.name || '', placeholder: 'T.ex. Split stretch' });
    const targetInput = el('input', { type: 'number', min: '1', value: String(existingVersion?.targetValue ?? 5) });
    const descInput = el('textarea', { value: existingVersion?.description || '', placeholder: 'Beskrivning / anteckningar (valfritt)' });
    const wdPicker = weekdayPicker(weekdays, () => {});

    const form = el('div', {}, [
      el('h2', { text: track ? 'Redigera dagligt mål' : 'Nytt dagligt mål' }),
      el('div.field', {}, [el('label', { text: 'Namn' }), nameInput]),
      el('div.field', {}, [el('label', { text: 'Målvärde per dag' }), targetInput]),
      el('div.field', {}, [el('label', { text: 'Vilka dagar' }), wdPicker]),
      el('div.field', {}, [el('label', { text: 'Beskrivning' }), descInput]),
      el('div.field', {}, [el('label', { text: 'Länkar' }), linksEditor(links, () => {})]),
      el('div.modal-actions', {}, [
        el('button.btn.primary.block', {
          text: 'Spara',
          onClick: async () => {
            const name = nameInput.value.trim();
            const targetValue = Number(targetInput.value);
            if (!name || !targetValue || targetValue <= 0) {
              toast('Fyll i namn och ett målvärde större än 0.');
              return;
            }
            if (weekdays.length === 0) {
              toast('Välj minst en veckodag.');
              return;
            }
            const payload = { name, targetValue, description: descInput.value.trim(), links, weekdays };
            if (track) {
              await editDailyGoal(track.id, payload, fromDate);
            } else {
              await addDailyGoal(periodId, payload, fromDate);
            }
            close();
            onSaved?.();
          },
        }),
        el('button.btn.block', { text: 'Avbryt', onClick: close }),
      ]),
    ]);
    return form;
  });
}

export function openLongTermGoalForm({ goal, onSaved }) {
  const links = goal ? [...goal.links] : [];

  openModal((close) => {
    const nameInput = el('input', { type: 'text', value: goal?.name || '', placeholder: 'T.ex. Göra en muscle-up' });
    const descInput = el('textarea', { value: goal?.description || '', placeholder: 'Beskrivning / anteckningar (valfritt)' });

    const form = el('div', {}, [
      el('h2', { text: goal ? 'Redigera långsiktigt mål' : 'Nytt långsiktigt mål' }),
      el('div.field', {}, [el('label', { text: 'Namn' }), nameInput]),
      el('div.field', {}, [el('label', { text: 'Beskrivning' }), descInput]),
      el('div.field', {}, [el('label', { text: 'Länkar' }), linksEditor(links, () => {})]),
      el('div.modal-actions', {}, [
        el('button.btn.primary.block', {
          text: 'Spara',
          onClick: async () => {
            const name = nameInput.value.trim();
            if (!name) {
              toast('Fyll i ett namn.');
              return;
            }
            const payload = { name, description: descInput.value.trim(), links };
            if (goal) {
              await editLongTermGoal(goal.id, payload);
            } else {
              await addLongTermGoal(payload);
            }
            close();
            onSaved?.();
          },
        }),
        el('button.btn.block', { text: 'Avbryt', onClick: close }),
      ]),
    ]);
    return form;
  });
}
