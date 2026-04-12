import {
  addDaysToDateString,
  effectiveDiscoveryDate,
  loadJsonData,
  selectPoemForDate
} from "./shared/common.js";
import { initLinkPrefetching } from "./shared/prefetch.js";
import { initSharing } from "./shared/share.js";

initLinkPrefetching();
initSharing();
let keyboardShortcutsBound = false;
let pendingNavigation = false;
const homeShortcutReturnKey = "serein-home-shortcut-return-date";

function poemRouteForDate(dateStr) {
  const match = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }
  return `/${match[1]}/${match[2]}/${match[3]}/`;
}

function shouldIgnoreShortcutTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest("input, textarea, select, button, [contenteditable='true'], [contenteditable=''], audio, video")
  );
}

function navigateByDay(main, dayCount) {
  if (pendingNavigation) {
    return false;
  }

  const currentDate = main?.dataset?.poemDate || "";
  const firstPoemDate = main?.dataset?.firstPoemDate || "";
  const nextDate = addDaysToDateString(currentDate, dayCount);
  const effectiveDate = effectiveDiscoveryDate({
    defaultAsOf: main?.dataset?.defaultAsOf || ""
  });
  if (dayCount < 0 && firstPoemDate && nextDate < firstPoemDate) {
    return false;
  }
  if (dayCount > 0 && nextDate > effectiveDate) {
    return false;
  }
  const nextRoute = poemRouteForDate(nextDate);
  if (!nextRoute) {
    return false;
  }

  if (dayCount < 0 && currentDate) {
    sessionStorage.setItem(homeShortcutReturnKey, currentDate);
  }
  pendingNavigation = true;
  window.location.assign(`${nextRoute}${window.location.search}${window.location.hash}`);
  return true;
}

function bindHomeKeyboardShortcuts(main) {
  if (keyboardShortcutsBound || !main) {
    return;
  }

  keyboardShortcutsBound = true;
  document.addEventListener("keydown", (event) => {
    if (
      event.defaultPrevented
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || shouldIgnoreShortcutTarget(event.target)
    ) {
      return;
    }

    if (event.key === "ArrowLeft") {
      if (navigateByDay(main, -1)) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === "ArrowRight") {
      if (navigateByDay(main, 1)) {
        event.preventDefault();
      }
    }
  });
}

function renderHomePoem(poem) {
  const main = document.querySelector('main[data-dynamic-page="1"]');
  const dateEl = document.getElementById("home-date");
  const shareEl = document.getElementById("home-share");
  const titleEl = document.getElementById("home-title");
  const metaEl = document.getElementById("home-meta");
  const contentEl = document.getElementById("home-content");
  if (!titleEl || !metaEl || !contentEl) {
    return;
  }

  if (!poem) {
    if (main) {
      main.dataset.poemDate = "";
    }
    if (dateEl) {
      dateEl.innerHTML = "";
    }
    if (shareEl) {
      shareEl.innerHTML = "";
    }
    titleEl.textContent = "A Poem Per Day";
    metaEl.textContent = "";
    contentEl.innerHTML = '<p class="empty">No poem is available for your local date yet.</p>';
    return;
  }

  if (main) {
    main.dataset.poemDate = poem.date || "";
  }
  if (dateEl) {
    dateEl.innerHTML = poem.dateHtml || "";
  }
  if (shareEl) {
    shareEl.innerHTML = poem.shareHtml || "";
  }
  titleEl.textContent = poem.title || "A Poem Per Day";
  metaEl.innerHTML = poem.poetMetaHtml || "";
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

  bindHomeKeyboardShortcuts(main);

  const markReady = () => {
    main.setAttribute("data-ready", "1");
    main.setAttribute("aria-busy", "false");
  };

  const markBusy = () => {
    main.setAttribute("aria-busy", "true");
  };

  const defaultAsOf = main.dataset.defaultAsOf || "";
  const renderedAsOf = main.dataset.renderedAsOf || "";
  const effectiveDate = effectiveDiscoveryDate({ defaultAsOf });
  if (/^\d{4}-\d{2}-\d{2}$/.test(renderedAsOf) && renderedAsOf === effectiveDate) {
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
