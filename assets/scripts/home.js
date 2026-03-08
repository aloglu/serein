import {
  effectiveDateFromQueryOrNow,
  escapeHtml,
  loadJsonData,
  selectPoemForDate
} from "./shared/common.js";

function renderHome(poems, effectiveDate) {
  const titleEl = document.getElementById("home-title");
  const metaEl = document.getElementById("home-meta");
  const contentEl = document.getElementById("home-content");
  if (!titleEl || !metaEl || !contentEl) {
    return;
  }

  const { current } = selectPoemForDate(poems, effectiveDate);
  if (!current) {
    titleEl.textContent = "A Poem Per Day";
    metaEl.textContent = "";
    contentEl.innerHTML = '<p class="empty">No poem is available for your local date yet.</p>';
    return;
  }

  titleEl.textContent = current.title || "A Poem Per Day";
  metaEl.innerHTML = current.authorMetaHtml || "";
  contentEl.innerHTML = current.poemHtml || '<p class="empty">Poem content is unavailable.</p>';
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
    renderHome(poems, effectiveDate);
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
