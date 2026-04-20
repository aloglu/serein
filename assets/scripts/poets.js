import {
  effectiveDiscoveryDate,
  escapeHtml,
  loadJsonData,
  selectPoemForDate
} from "./shared/common.js";
import { initLinkPrefetching } from "./shared/prefetch.js";
import { renderPoetsIndex } from "./shared/poets-index.mjs";

initLinkPrefetching();

function renderPoets(poems, effectiveDate) {
  const treeEl = document.getElementById("poets-tree");
  if (!treeEl) {
    return;
  }

  const { visible } = selectPoemForDate(poems, effectiveDate);
  treeEl.innerHTML = renderPoetsIndex(visible);
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
