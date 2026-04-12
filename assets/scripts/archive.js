import {
  sortMapKeysDesc,
  effectiveDiscoveryDate,
  escapeHtml,
  groupByYearMonth,
  loadJsonData,
  monthLabel,
  parseDateParts,
  selectPoemForDate
} from "./shared/common.js";
import { initLinkPrefetching } from "./shared/prefetch.js";

initLinkPrefetching();

function renderArchive(poems, effectiveDate) {
  const treeEl = document.getElementById("archive-tree");
  if (!treeEl) {
    return;
  }

  const { visible } = selectPoemForDate(poems, effectiveDate);
  if (visible.length === 0) {
    treeEl.innerHTML = "<p>No published poems yet.</p>";
    return;
  }

  const grouped = groupByYearMonth(visible);
  const years = sortMapKeysDesc(grouped);
  const currentYear = effectiveDate.slice(0, 4);
  const currentMonth = effectiveDate.slice(5, 7);

  treeEl.innerHTML = years
    .map((year) => {
      const monthsMap = grouped.get(year);
      const months = sortMapKeysDesc(monthsMap);
      const yearOpen = year === currentYear ? " open" : "";
      const defaultOpenMonth = year === currentYear ? (months.includes(currentMonth) ? currentMonth : months[0] || "") : "";
      const monthBlocks = months
        .map((month) => {
          const poemsInMonth = monthsMap.get(month);
          const monthOpen = year === currentYear && month === defaultOpenMonth ? " open" : "";
          const rows = poemsInMonth
            .map((poem) => {
              const day = escapeHtml(String(parseDateParts(poem.date)?.day || "--"));
              const href = `../${poem.route.slice(1)}/`;
              return `<li><span class="archive-day">${day}</span><span aria-hidden="true" class="separator-mark">&middot;</span><a href="${escapeHtml(href)}">${escapeHtml(poem.title)}</a></li>`;
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
  const effectiveDate = effectiveDiscoveryDate({ defaultAsOf });
  if (/^\d{4}-\d{2}-\d{2}$/.test(renderedAsOf) && renderedAsOf === effectiveDate) {
    markReady();
    return;
  }

  markBusy();
  try {
    const poems = await loadJsonData(main.dataset.pageDataUrl || "");
    renderArchive(poems, effectiveDate);
  } catch (error) {
    const target = document.getElementById("archive-tree");
    if (target) {
      target.innerHTML = `<p class="empty">${escapeHtml(error.message || "Failed to load poems.")}</p>`;
    }
  } finally {
    markReady();
  }
}

void init();
