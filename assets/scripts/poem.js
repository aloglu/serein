import { effectiveDateFromQueryOrNow } from "./shared/common.js";
import {
  formatFutureAvailabilityCountdown,
  nextFutureAvailabilityDelay,
  startScheduledCountdown
} from "./shared/countdown.js";

function initPoemAccessGuard() {
  const main = document.querySelector("main[data-poem-date]");
  const poemDate = main?.getAttribute("data-poem-date") || "";
  const defaultAsOf = main?.dataset?.defaultAsOf || "";
  const markReady = () => {
    if (main) {
      main.setAttribute("data-ready", "1");
    }
  };

  if (!main || !/^\d{4}-\d{2}-\d{2}$/.test(poemDate)) {
    markReady();
    return;
  }

  const effectiveDate = effectiveDateFromQueryOrNow({ defaultAsOf });
  if (poemDate <= effectiveDate) {
    markReady();
    return;
  }

  const [year, month, day] = poemDate.split("-").map((part) => Number(part));
  const availableAt = new Date(year, month - 1, day, 0, 0, 0, 0);
  const titleEl = main.querySelector("h1");
  const metaEl = main.querySelector(".meta");
  const contentEl = document.getElementById("poem-content");
  const setMetaContent = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) {
      el.setAttribute("content", value);
    }
  };

  const blockedTitle = "Not Available Yet | A Poem Per Day";
  const blockedDescription = "This poem is not available yet.";
  document.title = blockedTitle;
  setMetaContent('meta[name="description"]', blockedDescription);
  setMetaContent('meta[property="og:title"]', blockedTitle);
  setMetaContent('meta[name="twitter:title"]', blockedTitle);
  setMetaContent('meta[property="og:description"]', blockedDescription);
  setMetaContent('meta[name="twitter:description"]', blockedDescription);

  if (titleEl) {
    titleEl.textContent = "Not Available Yet";
  }
  if (metaEl) {
    metaEl.textContent = "";
  }
  if (contentEl) {
    const countdownId = "future-availability-countdown";
    contentEl.innerHTML = `<p>This poem will become available in <strong id="${countdownId}">--</strong> in your local time.</p>`;
    const countdownEl = document.getElementById(countdownId);
    if (countdownEl) {
      startScheduledCountdown({
        getSecondsRemaining: () => (availableAt.getTime() - Date.now()) / 1000,
        render: (secondsLeft) => {
          countdownEl.textContent = formatFutureAvailabilityCountdown(secondsLeft);
        },
        getNextDelay: nextFutureAvailabilityDelay,
        onExpire: () => {
          window.location.reload();
        }
      });
    }
  }

  markReady();
}

initPoemAccessGuard();
