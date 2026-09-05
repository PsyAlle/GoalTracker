// goalsPage.js
import { el, mount, toast, confirmModal } from "./dom.js";
import { getCurrentPeriod } from "../domain/periodLifecycle.js";
import {
  getWeeklyTracks,
  getWeeklyVersions,
  removeWeeklyGoal,
  getDailyTracks,
  getDailyVersions,
  removeDailyGoal,
  weekNumberInPeriod,
} from "../domain/goals.js";
import {
  getAllLongTermGoals,
  archiveLongTermGoal,
  unarchiveLongTermGoal,
  latestAssessment,
} from "../domain/longTermGoals.js";
import {
  openWeeklyGoalForm,
  openDailyGoalForm,
  openLongTermGoalForm,
} from "./goalForms.js";
import { todayStr, WEEKDAY_LABELS } from "../domain/dates.js";

export async function renderGoalsPage(container) {
  const period = await getCurrentPeriod();

  const root = el("div");
  root.appendChild(await renderLongTermSection());

  if (period && period.status === "active") {
    const currentWeek = weekNumberInPeriod(period.startDate, todayStr()) || 4;
    root.appendChild(await renderWeeklySection(period, currentWeek));
    root.appendChild(await renderDailySection(period, todayStr()));
  } else if (period && period.status === "planning") {
    root.appendChild(
      el("p", {
        class: "planning-banner",
        html: "<strong>Planeringsvecka pågår.</strong> Vecko- och dagliga mål för kommande period redigeras via Dashboard.",
      }),
    );
  } else {
    root.appendChild(
      el("p", { text: "Ingen period skapad ännu.", class: "empty-state" }),
    );
  }

  mount(container, root);
}

async function renderLongTermSection() {
  const goals = await getAllLongTermGoals();
  const active = goals.filter((g) => g.status === "active");
  const archived = goals.filter((g) => g.status === "archived");

  const section = el("div", {}, [
    el("div.section-title", { text: "LÅNGSIKTIGA MÅL" }),
    el("button.btn.primary.block", {
      text: "+ Nytt långsiktigt mål",
      onClick: () =>
        openLongTermGoalForm({
          onSaved: () => refreshPage(),
        }),
    }),
  ]);

  const list = el("div", { style: "margin-top: 12px" });
  for (const goal of active) {
    const latest = await latestAssessment(goal.id);
    list.appendChild(
      el("div.goal-card", {}, [
        el("div.goal-card-top", {}, [
          el("div", {}, [
            el("div.goal-name", { text: goal.name }),
            goal.description
              ? el("div.goal-meta", { text: goal.description })
              : null,
            latest
              ? el("div.goal-meta", {
                  text: `Senaste skattning: ${latest.score}/10`,
                })
              : null,
          ]),
        ]),
        el("div.goal-card-actions", {}, [
          el("button", {
            text: "Redigera",
            onClick: () =>
              openLongTermGoalForm({ goal, onSaved: () => refreshPage() }),
          }),
          el("button", {
            text: "Arkivera",
            onClick: async () => {
              await archiveLongTermGoal(goal.id);
              toast("Målet arkiverat.");
              refreshPage();
            },
          }),
        ]),
      ]),
    );
  }
  if (active.length === 0) {
    list.appendChild(
      el("p", { text: "Inga aktiva långsiktiga mål.", class: "goal-meta" }),
    );
  }
  section.appendChild(list);

  if (archived.length > 0) {
    section.appendChild(el("div.section-title", { text: "ARKIVERADE" }));
    const archList = el("div");
    for (const goal of archived) {
      archList.appendChild(
        el("div.goal-card", {}, [
          el("div.goal-card-top", {}, [
            el("div.goal-name", { text: goal.name }),
          ]),
          el("div.goal-card-actions", {}, [
            el("button", {
              text: "Återaktivera",
              onClick: async () => {
                await unarchiveLongTermGoal(goal.id);
                toast("Målet återaktiverat.");
                refreshPage();
              },
            }),
          ]),
        ]),
      );
    }
    section.appendChild(archList);
  }

  return section;
}

async function renderWeeklySection(period, currentWeek) {
  const tracks = await getWeeklyTracks(period.id);
  const section = el("div", {}, [
    el("div.section-title", { text: `VECKOMÅL (vecka ${currentWeek}/4)` }),
    el("button.btn.primary.block", {
      text: "+ Nytt veckomål",
      onClick: () =>
        openWeeklyGoalForm({
          periodId: period.id,
          currentWeek,
          onSaved: () => refreshPage(),
        }),
    }),
  ]);

  const list = el("div", { style: "margin-top: 12px" });
  for (const track of tracks) {
    const versions = await getWeeklyVersions(track.id);
    const latest = versions[versions.length - 1];
    if (!latest) continue;
    list.appendChild(
      el("div.goal-card", {}, [
        el("div.goal-card-top", {}, [
          el("div", {}, [
            el("div.goal-name", {
              text: `${latest.name} — ${latest.targetValue} ${latest.unit}`,
            }),
            latest.description
              ? el("div.goal-meta", { text: latest.description })
              : null,
          ]),
        ]),
        el("div.goal-card-actions", {}, [
          el("button", {
            text: "Redigera",
            onClick: () =>
              openWeeklyGoalForm({
                periodId: period.id,
                currentWeek,
                track,
                existingVersion: latest,
                onSaved: () => refreshPage(),
              }),
          }),
          el("button", {
            text: "Ta bort",
            onClick: () =>
              confirmModal({
                title: "Ta bort veckomål?",
                message: `"${latest.name}" och all registrerad progress för målet raderas permanent. Det går inte att ångra.`,
                onConfirm: async () => {
                  await removeWeeklyGoal(track.id);
                  toast("Veckomål borttaget.");
                  refreshPage();
                },
              }),
          }),
        ]),
      ]),
    );
  }
  if (tracks.length === 0)
    list.appendChild(
      el("p", { text: "Inga veckomål ännu.", class: "goal-meta" }),
    );
  section.appendChild(list);
  return section;
}

async function renderDailySection(period, todayDate) {
  const tracks = await getDailyTracks(period.id);
  const section = el("div", {}, [
    el("div.section-title", { text: "DAGLIGA MÅL" }),
    el("button.btn.primary.block", {
      text: "+ Nytt dagligt mål",
      onClick: () =>
        openDailyGoalForm({
          periodId: period.id,
          fromDate: todayDate,
          onSaved: () => refreshPage(),
        }),
    }),
  ]);

  const list = el("div", { style: "margin-top: 12px" });
  for (const track of tracks) {
    const versions = await getDailyVersions(track.id);
    const latest = versions[versions.length - 1];
    if (!latest) continue;
    const dayLabels = latest.weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ");
    list.appendChild(
      el("div.goal-card", {}, [
        el("div.goal-card-top", {}, [
          el("div", {}, [
            el("div.goal-name", {
              text: `${latest.name} — ${latest.targetValue}/dag`,
            }),
            el("div.goal-meta", { text: dayLabels }),
            latest.description
              ? el("div.goal-meta", { text: latest.description })
              : null,
          ]),
        ]),
        el("div.goal-card-actions", {}, [
          el("button", {
            text: "Redigera",
            onClick: () =>
              openDailyGoalForm({
                periodId: period.id,
                fromDate: todayDate,
                track,
                existingVersion: latest,
                onSaved: () => refreshPage(),
              }),
          }),
          el("button", {
            text: "Ta bort",
            onClick: () =>
              confirmModal({
                title: "Ta bort dagligt mål?",
                message: `"${latest.name}" och all registrerad progress för målet raderas permanent. Det går inte att ångra.`,
                onConfirm: async () => {
                  await removeDailyGoal(track.id);
                  toast("Dagligt mål borttaget.");
                  refreshPage();
                },
              }),
          }),
        ]),
      ]),
    );
  }
  if (tracks.length === 0)
    list.appendChild(
      el("p", { text: "Inga dagliga mål ännu.", class: "goal-meta" }),
    );
  section.appendChild(list);
  return section;
}

function refreshPage() {
  const container = document.querySelector("#view-container");
  if (container) renderGoalsPage(container);
}
