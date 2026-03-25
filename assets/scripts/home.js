import {
  effectiveDateFromQueryOrNow,
  loadJsonData,
  selectPoemForDate
} from "./shared/common.js";
import { initLinkPrefetching } from "./shared/prefetch.js";
import { bindTtsPlayers, resetTtsPlayback } from "./shared/tts.js";

initLinkPrefetching();

function renderHomePoem(poem) {
  const dateEl = document.getElementById("home-date");
  const titleEl = document.getElementById("home-title");
  const metaEl = document.getElementById("home-meta");
  const contentEl = document.getElementById("home-content");
  if (!titleEl || !metaEl || !contentEl) {
    return;
  }

  if (!poem) {
    if (dateEl) {
      dateEl.innerHTML = "";
    }
    titleEl.textContent = "A Poem Per Day";
    metaEl.textContent = "";
    contentEl.innerHTML = '<p class="empty">No poem is available for your local date yet.</p>';
    return;
  }

  resetTtsPlayback();
  if (dateEl) {
    dateEl.innerHTML = poem.dateHtml || "";
  }
  titleEl.textContent = poem.title || "A Poem Per Day";
  metaEl.innerHTML = poem.authorMetaHtml || "";
  bindTtsPlayers(metaEl);
  contentEl.innerHTML = poem.poemHtml || '<p class="empty">Poem content is unavailable.</p>';
}

async function resolveHomePoem(entry) {
  if (!entry) {
    return null;
  }
  if (entry.pageDataUrl) {
    return loadJsonData(entry.pageDataUrl);
  }
  return entry;
}

async function renderHome(payload, effectiveDate) {
  const poems = Array.isArray(payload?.poems) ? payload.poems : [];
  const upcoming = Array.isArray(payload?.upcoming) ? payload.upcoming : [];
  const { current } = selectPoemForDate(poems, effectiveDate);
  const upcomingEntry = upcoming.find((entry) => entry?.date === effectiveDate);
  if (current?.date === effectiveDate) {
    const currentPoem = await resolveHomePoem(current);
    renderHomePoem(currentPoem);
    return;
  }

  if (upcomingEntry) {
    const upcomingPoem = await resolveHomePoem(upcomingEntry);
    renderHomePoem(upcomingPoem);
    return;
  }

  if (current) {
    const currentPoem = await resolveHomePoem(current);
    renderHomePoem(currentPoem);
    return;
  }

  renderHomePoem(null);
}

async function init() {
  const main = document.querySelector('main[data-dynamic-page="1"]');
  if (!main) {
    return;
  }

  const markReady = () => {
    main.setAttribute("data-ready", "1");
    main.setAttribute("aria-busy", "false");
  };

  const markBusy = () => {
    main.setAttribute("aria-busy", "true");
  };

  const defaultAsOf = main.dataset.defaultAsOf || "";
  const renderedAsOf = main.dataset.renderedAsOf || "";
  const effectiveDate = effectiveDateFromQueryOrNow({ defaultAsOf });
  if (/^\d{4}-\d{2}-\d{2}$/.test(renderedAsOf) && renderedAsOf === effectiveDate) {
    bindTtsPlayers(main);
    markReady();
    return;
  }

  markBusy();
  try {
    const poems = await loadJsonData(main.dataset.pageDataUrl || "");
    await renderHome(poems, effectiveDate);
  } catch (error) {
    console.error("Failed to refresh home content.", error);
  } finally {
    markReady();
  }
}

void init();
