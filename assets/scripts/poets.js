import {
  effectiveDiscoveryDate,
  escapeHtml,
  formatPoetIndexLabel,
  groupByPoetInitial,
  loadJsonData,
  sortPoetInitials,
  sortPoets,
  selectPoemForDate
} from "./shared/common.js";
import { initLinkPrefetching } from "./shared/prefetch.js";

initLinkPrefetching();

function renderPoets(poems, effectiveDate) {
  const treeEl = document.getElementById("poets-tree");
  if (!treeEl) {
    return;
  }

  const { visible } = selectPoemForDate(poems, effectiveDate);
  if (visible.length === 0) {
    treeEl.innerHTML = "<p>No published poets yet.</p>";
    return;
  }

  const grouped = groupByPoetInitial(visible);
  const letters = sortPoetInitials(grouped.keys());

  treeEl.innerHTML = letters
    .map((letter) => {
      const poetsMap = grouped.get(letter);
      const poets = sortPoets(poetsMap.keys());
      const poetBlocks = poets
        .map((poet) => {
          const poemsByPoet = poetsMap.get(poet);
          const poetRoute = poemsByPoet[0]?.poetRoute || "";
          const label = formatPoetIndexLabel(poet);
          const poetLabel = poetRoute
            ? `<a href="${escapeHtml(`${poetRoute}/`)}">${escapeHtml(label)}</a>`
            : escapeHtml(label);
          return `<li class="poet-authors-item">${poetLabel}</li>`;
        })
        .join("");
      return `<details class="archive-year poet-letter"><summary>${escapeHtml(letter)}</summary><div class="archive-months poet-groups"><ul class="poet-authors">${poetBlocks}</ul></div></details>`;
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
    renderPoets(poems, effectiveDate);
  } catch (error) {
    const target = document.getElementById("poets-tree");
    if (target) {
      target.innerHTML = `<p class="empty">${escapeHtml(error.message || "Failed to load poems.")}</p>`;
    }
  } finally {
    markReady();
  }
}

void init();
