import {
  sortMapKeysDesc,
  effectiveDiscoveryDate,
  escapeHtml,
  groupByYearMonth,
  loadJsonData,
  monthLabel,
  selectPoemForDate
} from "./shared/common.js";
import { initLinkPrefetching } from "./shared/prefetch.js";

initLinkPrefetching();

function renderPoetArchive(poems, effectiveDate) {
  const treeEl = document.getElementById("poet-page-tree");
  if (!treeEl) {
    return;
  }

  const { visible } = selectPoemForDate(poems, effectiveDate);
  const publishedPoetPoems = visible;

  if (publishedPoetPoems.length === 0) {
    const poetName = document.getElementById("poet-page-poet")?.textContent || "this poet";
    treeEl.innerHTML = `<p>No published poems by ${escapeHtml(poetName)} yet.</p>`;
    return;
  }

  const todayParts = effectiveDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const currentYear = todayParts ? todayParts[1] : "";
  const currentMonth = todayParts ? todayParts[2] : "";
  const grouped = groupByYearMonth(publishedPoetPoems);
  const years = sortMapKeysDesc(grouped);

  treeEl.innerHTML = years
    .map((year) => {
      const monthsMap = grouped.get(year);
      const months = sortMapKeysDesc(monthsMap);
      const yearOpen = year === currentYear ? " open" : "";
      const defaultOpenMonth = year === currentYear ? (months.includes(currentMonth) ? currentMonth : months[0] || "") : "";
      const monthBlocks = months
        .map((month) => {
          const poemsByMonth = monthsMap.get(month);
          const monthOpen = year === currentYear && month === defaultOpenMonth ? " open" : "";
          const rows = poemsByMonth
            .map((poem) => {
              const day = poem.date.slice(-2);
              return `<li><span class="archive-day">${escapeHtml(day)}</span><span aria-hidden="true" class="separator-mark">&middot;</span><a href="${escapeHtml(`${poem.route}/`)}">${escapeHtml(poem.title)}</a></li>`;
            })
            .join("");
          return `<details class="archive-month"${monthOpen}><summary>${escapeHtml(monthLabel(month))}</summary><ul class="archive-poems">${rows}</ul></details>`;
        })
        .join("");
      return `<details class="archive-year"${yearOpen}><summary>${escapeHtml(year)}</summary><div class="archive-months">${monthBlocks}</div></details>`;
    })
    .join("");
}

async function init() {
  const main = document.querySelector('main[data-dynamic-page="1"][data-poet-route]');
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
  const effectiveDate = effectiveDiscoveryDate({ defaultAsOf });
  if (/^\d{4}-\d{2}-\d{2}$/.test(renderedAsOf) && renderedAsOf === effectiveDate) {
    markReady();
    return;
  }

  markBusy();
  try {
    const dataUrl = main.dataset.pageDataUrl || "";
    if (!dataUrl) {
      return;
    }
    const poems = await loadJsonData(dataUrl);
    renderPoetArchive(poems, effectiveDate);
  } catch (error) {
    const target = document.getElementById("poet-page-tree");
    if (target) {
      target.innerHTML = `<p class="empty">${escapeHtml(error.message || "Failed to load poems.")}</p>`;
    }
  } finally {
    markReady();
  }
}

void init();
