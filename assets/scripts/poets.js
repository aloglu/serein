import {
  compareAuthors,
  effectiveDateFromQueryOrNow,
  escapeHtml,
  formatAuthorIndexLabel,
  groupByAuthorInitial,
  loadJsonData,
  selectPoemForDate
} from "./shared/common.js";

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

  const grouped = groupByAuthorInitial(visible);
  const letters = Array.from(grouped.keys()).sort((a, b) => {
    if (a === "#") {
      return 1;
    }
    if (b === "#") {
      return -1;
    }
    return compareAuthors(a, b);
  });

  treeEl.innerHTML = letters
    .map((letter) => {
      const authorsMap = grouped.get(letter);
      const authors = Array.from(authorsMap.keys()).sort((a, b) => compareAuthors(a, b));
      const poetBlocks = authors
        .map((author) => {
          const poemsByAuthor = authorsMap.get(author);
          const authorRoute = poemsByAuthor[0]?.authorRoute || "";
          const label = formatAuthorIndexLabel(author);
          const authorLabel = authorRoute
            ? `<a href="${escapeHtml(`${authorRoute}/`)}">${escapeHtml(label)}</a>`
            : escapeHtml(label);
          return `<li class="poet-authors-item">${authorLabel}</li>`;
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
