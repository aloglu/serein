import {
  effectiveDateFromQueryOrNow,
  escapeHtml,
  loadJsonData,
  selectPoemForDate
} from "./shared/common.js";

function formatHomeDate(dateStr) {
  const match = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function renderHome(poems, effectiveDate) {
  const titleEl = document.getElementById("home-title");
  const titleLinkEl = document.getElementById("home-title-link");
  const metaEl = document.getElementById("home-meta");
  const excerptEl = document.getElementById("home-excerpt");
  const dateEl = document.getElementById("home-feature-date");
  const readLinkEl = document.getElementById("home-read-link");
  if (!titleEl || !titleLinkEl || !metaEl || !excerptEl || !dateEl || !readLinkEl) {
    return;
  }

  const { current } = selectPoemForDate(poems, effectiveDate);
  if (!current) {
    titleEl.textContent = "No poem published yet";
    titleLinkEl.setAttribute("href", "/archive/");
    metaEl.textContent = "";
    excerptEl.textContent = "The archive is still empty. The first published poem will appear here.";
    dateEl.textContent = "";
    readLinkEl.textContent = "Browse the archive";
    readLinkEl.setAttribute("href", "/archive/");
    return;
  }

  const route = current.route ? `${current.route}/` : "/archive/";
  titleEl.textContent = current.title || "Untitled";
  titleLinkEl.setAttribute("href", route);
  metaEl.innerHTML = current.authorMetaHtml || "";
  excerptEl.textContent = current.excerpt || "Read the full poem.";
  dateEl.textContent = current.date ? `Published ${formatHomeDate(current.date)}` : "";
  readLinkEl.textContent = "Read the full poem";
  readLinkEl.setAttribute("href", route);
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
    const target = document.getElementById("home-excerpt");
    if (target) {
      target.innerHTML = `<span class="empty">${escapeHtml(error.message || "Failed to load poems.")}</span>`;
    }
  } finally {
    markReady();
  }
}

void init();
