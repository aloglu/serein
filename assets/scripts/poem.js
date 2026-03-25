import {
  effectiveDateFromQueryOrNow,
  escapeHtml,
  loadJsonData,
  runtimeAsOfEnabled
} from "./shared/common.js";
import { initLinkPrefetching } from "./shared/prefetch.js";
import {
  bindTtsPlayers,
  resetTtsPlayback,
  stepTtsPlaybackSpeed,
  toggleTtsPlayback
} from "./shared/tts.js";
import {
  formatFutureAvailabilityCountdown,
  nextFutureAvailabilityDelay,
  startScheduledCountdown
} from "./shared/countdown.js";

initLinkPrefetching();

const blockedHeading = "Not Available Yet";
const blockedTitle = `${blockedHeading} | A Poem Per Day`;
const blockedDescription = "This poem is not available yet.";
const homeShortcutReturnKey = "serein-home-shortcut-return-date";
let keyboardShortcutsBound = false;
let pendingNavigation = false;

function setMetaContent(selector, value) {
  const el = document.querySelector(selector);
  if (el) {
    el.setAttribute("content", value);
  }
}

function renderBlockedPoem(main, { withCountdown = true } = {}) {
  const titleEl = main.querySelector("h1");
  const metaEl = main.querySelector(".poem-meta");
  const contentEl = document.getElementById("poem-content");

  document.title = blockedTitle;
  setMetaContent('meta[name="author"]', "");
  setMetaContent('meta[name="description"]', blockedDescription);
  setMetaContent('meta[property="og:title"]', blockedTitle);
  setMetaContent('meta[name="twitter:title"]', blockedTitle);
  setMetaContent('meta[property="og:description"]', blockedDescription);
  setMetaContent('meta[name="twitter:description"]', blockedDescription);

  resetTtsPlayback();
  if (titleEl) {
    titleEl.textContent = blockedHeading;
  }
  if (metaEl) {
    metaEl.textContent = "";
  }
  if (contentEl) {
    contentEl.innerHTML = withCountdown
      ? '<p>This poem will become available in <strong id="future-availability-countdown">--</strong> in your local time.</p>'
      : `<p>${escapeHtml(blockedDescription)}</p>`;
  }
}

function renderPublishedPoem(main, poem) {
  const titleEl = main.querySelector("h1");
  const metaEl = main.querySelector(".poem-meta");
  const contentEl = document.getElementById("poem-content");
  const pageTitle = poem?.title ? `${poem.title} | A Poem Per Day` : "A Poem Per Day";

  document.title = pageTitle;
  setMetaContent('meta[name="author"]', poem?.author || "");
  setMetaContent('meta[name="description"]', poem?.description || "");
  setMetaContent('meta[property="og:title"]', pageTitle);
  setMetaContent('meta[name="twitter:title"]', pageTitle);
  setMetaContent('meta[property="og:description"]', poem?.description || "");
  setMetaContent('meta[name="twitter:description"]', poem?.description || "");

  resetTtsPlayback();
  if (titleEl) {
    titleEl.textContent = poem?.title || "";
  }
  if (metaEl) {
    metaEl.innerHTML = poem?.authorMetaHtml || "";
    bindTtsPlayers(metaEl);
  }
  if (contentEl) {
    contentEl.innerHTML = poem?.poemHtml || '<p class="empty">Poem content is unavailable.</p>';
  }
  main.dataset.poemBlocked = "0";
}

async function loadPublishedPoem(main) {
  const dataUrl = main.dataset.pageDataUrl || "";
  if (!dataUrl) {
    throw new Error("Poem data is unavailable.");
  }
  main.setAttribute("aria-busy", "true");
  try {
    const poem = await loadJsonData(dataUrl);
    renderPublishedPoem(main, poem);
  } finally {
    main.setAttribute("aria-busy", "false");
  }
}

function addDaysToDateString(dateStr, dayCount) {
  const match = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + dayCount);
  return date.toISOString().slice(0, 10);
}

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
  if (target.closest("[data-tts-root]")) {
    return true;
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
  const effectiveDate = effectiveDateFromQueryOrNow({
    defaultAsOf: main?.dataset?.defaultAsOf || ""
  });
  if (dayCount < 0 && firstPoemDate && nextDate < firstPoemDate) {
    return false;
  }
  if (dayCount > 0 && nextDate > effectiveDate) {
    return false;
  }

  const homeReturnDate = sessionStorage.getItem(homeShortcutReturnKey) || "";
  if (dayCount > 0 && homeReturnDate && nextDate === homeReturnDate) {
    sessionStorage.removeItem(homeShortcutReturnKey);
    pendingNavigation = true;
    window.location.assign(`/${window.location.search}${window.location.hash}`);
    return true;
  }

  const nextRoute = poemRouteForDate(nextDate);
  if (!nextRoute) {
    return false;
  }

  pendingNavigation = true;
  window.location.assign(`${nextRoute}${window.location.search}${window.location.hash}`);
  return true;
}

function bindPoemKeyboardShortcuts(main) {
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

    if (event.key === " " || event.key.toLowerCase() === "p") {
      const handled = toggleTtsPlayback(main);
      if (handled) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === "ArrowUp") {
      const handled = stepTtsPlaybackSpeed(1, main);
      if (handled) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      const handled = stepTtsPlaybackSpeed(-1, main);
      if (handled) {
        event.preventDefault();
      }
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

async function initPoemAccessGuard() {
  const main = document.querySelector("main[data-poem-date]");
  const poemDate = main?.getAttribute("data-poem-date") || "";
  const defaultAsOf = main?.dataset?.defaultAsOf || "";
  const queryAsOf = runtimeAsOfEnabled() ? (new URLSearchParams(window.location.search).get("as_of") || "") : "";
  const hasQueryOverride = /^\d{4}-\d{2}-\d{2}$/.test(queryAsOf);
  const markReady = () => {
    if (main) {
      main.setAttribute("data-ready", "1");
      main.setAttribute("aria-busy", "false");
    }
  };

  if (!main || !/^\d{4}-\d{2}-\d{2}$/.test(poemDate)) {
    bindTtsPlayers(document);
    markReady();
    return;
  }

  bindPoemKeyboardShortcuts(main);

  const effectiveDate = effectiveDateFromQueryOrNow({ defaultAsOf });
  if (poemDate <= effectiveDate) {
    try {
      if (main.dataset.poemBlocked === "1") {
        await loadPublishedPoem(main);
      } else {
        bindTtsPlayers(document);
      }
    } catch (error) {
      const contentEl = document.getElementById("poem-content");
      if (contentEl) {
        contentEl.innerHTML = `<p class="empty">${escapeHtml(error?.message || "Failed to load poem.")}</p>`;
      }
    }
    markReady();
    return;
  }

  const [year, month, day] = poemDate.split("-").map((part) => Number(part));
  const availableAt = new Date(year, month - 1, day, 0, 0, 0, 0);
  renderBlockedPoem(main, { withCountdown: !hasQueryOverride });

  if (!hasQueryOverride) {
    const countdownEl = document.getElementById("future-availability-countdown");
    if (countdownEl) {
      startScheduledCountdown({
        getSecondsRemaining: () => (availableAt.getTime() - Date.now()) / 1000,
        render: (secondsLeft) => {
          countdownEl.textContent = formatFutureAvailabilityCountdown(secondsLeft);
        },
        getNextDelay: nextFutureAvailabilityDelay,
        onExpire: () => {
          void loadPublishedPoem(main).catch(() => {
            window.location.reload();
          });
        }
      });
    }
  }

  markReady();
}

void initPoemAccessGuard();
