// main.js
import { el, mount } from "./render/dom.js";
import { runLifecycleCheck } from "./domain/periodLifecycle.js";
import { renderDashboard } from "./render/dashboard.js";
import { renderGoalsPage } from "./render/goalsPage.js";
import { renderHistoryPage } from "./render/history.js";
import { openOverflowMenu } from "./render/overflowMenu.js";

const TABS = [
  { id: "dashboard", label: "Dashboard", render: renderDashboard },
  { id: "goals", label: "Mål", render: renderGoalsPage },
  { id: "history", label: "Historik", render: renderHistoryPage },
];

function currentTabId() {
  const hash = window.location.hash.replace("#/", "");
  return TABS.some((t) => t.id === hash) ? hash : "dashboard";
}

async function buildShell() {
  const app = document.getElementById("app");

  const topbar = el("div.topbar", {}, [
    el("h1", { text: "Loggboken" }),
    el("button.overflow-btn", {
      text: "⋯",
      onClick: () => openOverflowMenu(() => renderCurrentTab()),
    }),
  ]);

  const viewContainer = el("div#view-container.main");

  const tabButtons = {};
  const tabbar = el(
    "div.tabbar",
    {},
    TABS.map((tab) => {
      const btn = el("button", {
        text: tab.label,
        onClick: () => {
          window.location.hash = `#/${tab.id}`;
        },
      });
      tabButtons[tab.id] = btn;
      return btn;
    }),
  );

  mount(app, el("div", {}, [topbar, viewContainer, tabbar]));

  async function renderCurrentTab() {
    const activeId = currentTabId();
    for (const tab of TABS) {
      tabButtons[tab.id].classList.toggle("active", tab.id === activeId);
    }
    const active = TABS.find((t) => t.id === activeId);
    await active.render(viewContainer);
  }

  window.addEventListener("hashchange", renderCurrentTab);
  return renderCurrentTab;
}

async function init() {
  await runLifecycleCheck();
  const renderCurrentTab = await buildShell();
  await renderCurrentTab();

  // Re-run the lifecycle check periodically in case the app is left open
  // across a day/week boundary, and re-render if a transition happened.
  setInterval(
    async () => {
      await runLifecycleCheck();
      await renderCurrentTab();
    },
    60 * 60 * 1000,
  ); // hourly is plenty; transitions are date-based, not time-based
}

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
