import {
  effectiveDateFromQueryOrNow,
  escapeHtml,
  loadJsonData,
  runtimeAsOfEnabled
} from "./shared/common.js";
import { initLinkPrefetching } from "./shared/prefetch.js";
import {
  formatFutureAvailabilityCountdown,
  nextFutureAvailabilityDelay,
  startScheduledCountdown
} from "./shared/countdown.js";

initLinkPrefetching();

const blockedHeading = "Not Available Yet";
const blockedTitle = `${blockedHeading} | A Poem Per Day`;
const blockedDescription = "This poem is not available yet.";

function setMetaContent(selector, value) {
  const el = document.querySelector(selector);
  if (el) {
    el.setAttribute("content", value);
  }
}

function renderTtsBlock(tts) {
  if (!tts?.audioUrl) {
    return "";
  }

  const mimeType = escapeHtml(tts?.mimeType || "audio/mpeg");
  const audioUrl = escapeHtml(tts.audioUrl);

  return `<div class="poem-tts" data-tts-root>
    <button class="tts-toggle" type="button" data-tts-toggle aria-label="Listen to this poem">
      <span class="tts-toggle-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M3 9v6h4l5 4V5L7 9H3Zm12.5 3a4.5 4.5 0 0 0-2.35-3.95v7.9A4.5 4.5 0 0 0 15.5 12Zm-2.35-8.77v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54Z"></path>
        </svg>
      </span>
      <span class="tts-toggle-label" data-tts-label>Listen</span>
    </button>
    <p class="meta poem-tts-status" data-tts-status aria-live="polite"></p>
    <audio preload="none" data-tts-audio>
      <source src="${audioUrl}" type="${mimeType}">
    </audio>
  </div>`;
}

function bindTtsPlayers(scope = document) {
  const players = scope.querySelectorAll("[data-tts-root]");

  for (const player of players) {
    if (player.dataset.ttsBound === "1") {
      continue;
    }

    player.dataset.ttsBound = "1";
    const button = player.querySelector("[data-tts-toggle]");
    const label = player.querySelector("[data-tts-label]");
    const status = player.querySelector("[data-tts-status]");
    const audio = player.querySelector("[data-tts-audio]");

    if (!button || !label || !status || !audio) {
      continue;
    }

    const updateUi = (state) => {
      if (state === "playing") {
        label.textContent = "Pause";
        status.textContent = "Playing audio.";
        return;
      }
      if (state === "loading") {
        label.textContent = "Loading...";
        status.textContent = "Loading audio.";
        return;
      }
      if (state === "paused") {
        label.textContent = audio.currentTime > 0 ? "Resume" : "Listen";
        status.textContent = audio.currentTime > 0 ? "Playback paused." : "";
        return;
      }
      if (state === "ended") {
        label.textContent = "Listen again";
        status.textContent = "Playback finished.";
        return;
      }
      if (state === "error") {
        label.textContent = "Listen";
        status.textContent = "Audio is unavailable right now.";
      }
    };

    button.addEventListener("click", async () => {
      if (!audio.paused && !audio.ended) {
        audio.pause();
        return;
      }

      updateUi("loading");
      try {
        await audio.play();
      } catch {
        updateUi("error");
      }
    });

    audio.addEventListener("play", () => updateUi("playing"));
    audio.addEventListener("pause", () => updateUi(audio.ended ? "ended" : "paused"));
    audio.addEventListener("ended", () => updateUi("ended"));
    audio.addEventListener("waiting", () => updateUi("loading"));
    audio.addEventListener("error", () => updateUi("error"));
    updateUi("paused");
  }
}

function renderBlockedPoem(main, { withCountdown = true } = {}) {
  const titleEl = main.querySelector("h1");
  const metaEl = main.querySelector(".poem-meta");
  const ttsSlot = document.getElementById("poem-tts-slot");
  const contentEl = document.getElementById("poem-content");

  document.title = blockedTitle;
  setMetaContent('meta[name="author"]', "");
  setMetaContent('meta[name="description"]', blockedDescription);
  setMetaContent('meta[property="og:title"]', blockedTitle);
  setMetaContent('meta[name="twitter:title"]', blockedTitle);
  setMetaContent('meta[property="og:description"]', blockedDescription);
  setMetaContent('meta[name="twitter:description"]', blockedDescription);

  if (titleEl) {
    titleEl.textContent = blockedHeading;
  }
  if (metaEl) {
    metaEl.textContent = "";
  }
  if (ttsSlot) {
    ttsSlot.innerHTML = "";
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
  const ttsSlot = document.getElementById("poem-tts-slot");
  const contentEl = document.getElementById("poem-content");
  const pageTitle = poem?.title ? `${poem.title} | A Poem Per Day` : "A Poem Per Day";

  document.title = pageTitle;
  setMetaContent('meta[name="author"]', poem?.author || "");
  setMetaContent('meta[name="description"]', poem?.description || "");
  setMetaContent('meta[property="og:title"]', pageTitle);
  setMetaContent('meta[name="twitter:title"]', pageTitle);
  setMetaContent('meta[property="og:description"]', poem?.description || "");
  setMetaContent('meta[name="twitter:description"]', poem?.description || "");

  if (titleEl) {
    titleEl.textContent = poem?.title || "";
  }
  if (metaEl) {
    metaEl.innerHTML = poem?.authorMetaHtml || "";
  }
  if (ttsSlot) {
    ttsSlot.innerHTML = renderTtsBlock(poem?.tts || null);
    bindTtsPlayers(ttsSlot);
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
  const poem = await loadJsonData(dataUrl);
  renderPublishedPoem(main, poem);
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
    }
  };

  if (!main || !/^\d{4}-\d{2}-\d{2}$/.test(poemDate)) {
    bindTtsPlayers(document);
    markReady();
    return;
  }

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
