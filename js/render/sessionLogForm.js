// sessionLogForm.js
import { el, openModal, toast } from './dom.js';
import { addSessionLog, getGoalRefOptions } from '../domain/sessionLogs.js';

/**
 * Opens the "log a session" modal. The goal is entirely optional: the
 * dropdown always has a "no goal" option selected by default, and saving
 * with it selected stores goalRef: null.
 */
export async function openSessionLogForm({ periodId, dateStr, minDate, maxDate, onSaved }) {
  const goalOptions = await getGoalRefOptions(periodId);

  openModal((close) => {
    const NO_GOAL = "__none__";
    const dateInput = el("input", {
      type: "date",
      value: dateStr,
      min: minDate || undefined,
      max: maxDate || undefined,
    });
    const goalSelect = el(
      "select",
      {},
      [
        el("option", { text: "— Inget specifikt mål —", value: NO_GOAL }),
        ...goalOptions.map((opt) =>
          el("option", { text: opt.label, value: `${opt.kind}:${opt.id}` }),
        ),
      ],
    );

    const readinessInput = el("input", {
      type: "range",
      min: "0",
      max: "10",
      step: "1",
      value: "6",
    });
    const readinessReadout = el("div.score-readout", { text: "6/10" });
    readinessInput.addEventListener("input", () => {
      readinessReadout.textContent = `${readinessInput.value}/10`;
    });

    const rpeInput = el("input", {
      type: "range",
      min: "0",
      max: "10",
      step: "1",
      value: "6",
    });
    const rpeReadout = el("div.score-readout", { text: "6/10" });
    rpeInput.addEventListener("input", () => {
      rpeReadout.textContent = `${rpeInput.value}/10`;
    });

    const noteInput = el("textarea", {
      placeholder: "Hur kändes passet? Vad gick bra, vad var svårt...",
    });

    const form = el("div", {}, [
      el("h2", { text: "Ny logg" }),
      el("div.field", {}, [el("label", { text: "Datum" }), dateInput]),
      el("div.field", {}, [el("label", { text: "Mål (valfritt)" }), goalSelect]),
      el("div.field-row", {}, [
        el("div.field", {}, [
          el("label", { text: "Readiness" }),
          readinessInput,
          readinessReadout,
        ]),
        el("div.field", {}, [
          el("label", { text: "RPE" }),
          rpeInput,
          rpeReadout,
        ]),
      ]),
      el("div.field", {}, [el("label", { text: "Anteckning" }), noteInput]),
      el("div.modal-actions", {}, [
        el("button.btn.primary.block", {
          text: "Spara",
          onClick: async () => {
            const raw = goalSelect.value;
            const goalRef =
              raw === NO_GOAL
                ? null
                : { kind: raw.split(":")[0], id: raw.split(":").slice(1).join(":") };
            const pickedDate = dateInput.value || dateStr;
            await addSessionLog(periodId, pickedDate, {
              goalRef,
              readiness: Number(readinessInput.value),
              rpe: Number(rpeInput.value),
              note: noteInput.value.trim(),
            });
            close();
            toast("Logg sparad.");
            onSaved?.();
          },
        }),
        el("button.btn.block", { text: "Avbryt", onClick: close }),
      ]),
    ]);
    return form;
  });
}
