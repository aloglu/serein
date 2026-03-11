import {
  effectiveDateFromQueryOrNow,
  escapeHtml,
  loadJsonData,
  selectPoemForDate
} from "./shared/common.js";

function renderHomePoem(poem) {
  const titleEl = document.getElementById("home-title");
  const metaEl = document.getElementById("home-meta");
  const contentEl = document.getElementById("home-content");
  if (!titleEl || !metaEl || !contentEl) {
    return;
  }

  if (!poem) {
    titleEl.textContent = "A Poem Per Day";
    metaEl.textContent = "";
    contentEl.innerHTML = '<p class="empty">No poem is available for your local date yet.</p>';
    return;
  }

  titleEl.textContent = poem.title || "A Poem Per Day";
  metaEl.innerHTML = poem.authorMetaHtml || "";
  contentEl.innerHTML = poem.poemHtml || '<p class="empty">Poem content is unavailable.</p>';
}

function normalizeHomePayload(payload) {
  if (Array.isArray(payload)) {
    return {
      poems: payload,
      upcoming: []
    };
  }

  return {
    poems: Array.isArray(payload?.poems) ? payload.poems : [],
    upcoming: Array.isArray(payload?.upcoming) ? payload.upcoming : []
  };
}

async function renderHome(payload, effectiveDate) {
  const { poems, upcoming } = normalizeHomePayload(payload);
  const { current } = selectPoemForDate(poems, effectiveDate);
  if (current?.date === effectiveDate) {
    renderHomePoem(current);
    return;
  }

  const upcomingEntry = upcoming.find((entry) => entry?.date === effectiveDate && entry?.pageDataUrl);
  if (upcomingEntry) {
    const upcomingPoem = await loadJsonData(upcomingEntry.pageDataUrl);
    renderHomePoem(upcomingPoem);
    return;
  }

  renderHomePoem(current);
}

async function init() {
  const main = document.querySelector('main[data-dynamic-page="1"]');
  if (!main) {
    return;
  }

  const markReady = () => {
    main.setAttribute("data-ready", "1");
  };

  const defaultAsOf = main.dataset.defaultAsOf || "";
  const renderedAsOf = main.dataset.renderedAsOf || "";
  const effectiveDate = effectiveDateFromQueryOrNow({ defaultAsOf });
  if (/^\d{4}-\d{2}-\d{2}$/.test(renderedAsOf) && renderedAsOf === effectiveDate) {
    markReady();
    return;
  }

  try {
    const poems = await loadJsonData(main.dataset.pageDataUrl || "");
    await renderHome(poems, effectiveDate);
  } catch (error) {
    const target = document.getElementById("home-content");
    if (target) {
      target.innerHTML = `<p class="empty">${escapeHtml(error.message || "Failed to load poems.")}</p>`;
    }
  } finally {
    markReady();
  }
}

void init();
