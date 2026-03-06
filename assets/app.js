function normalizedRoutePath() {
  const raw = window.location.pathname || "/";
  const noIndex = raw.replace(/index\.html$/i, "");
  if (!noIndex || noIndex === "/") {
    return "/";
  }
  return noIndex.endsWith("/") ? noIndex : `${noIndex}/`;
}

function poemsDataPath() {
  const routePath = normalizedRoutePath();
  if (routePath.endsWith("/archive/") || routePath.endsWith("/poets/")) {
    return "../poems-data.json";
  }
  return "./poems-data.json";
}

function localDateString(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function effectiveDateFromQueryOrNow({ allowQueryOverride = true, defaultAsOf = "" } = {}) {
  if (allowQueryOverride) {
    const queryDate = new URLSearchParams(window.location.search).get("as_of") || "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
      return queryDate;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(defaultAsOf || "").trim())) {
    return String(defaultAsOf).trim();
  }
  return localDateString();
}

function monthLabel(monthNumber) {
  const month = Number(monthNumber);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return String(monthNumber || "");
  }
  const dt = new Date(Date.UTC(2024, month - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(dt);
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pluralize(value, singular, plural) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatCountdown(secondsRemaining) {
  const safe = Math.max(0, Math.floor(secondsRemaining));
  if (safe < 60) {
    return pluralize(safe, "second", "seconds");
  }
  if (safe < 3600) {
    const minutes = Math.floor(safe / 60);
    return pluralize(minutes, "minute", "minutes");
  }
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${pluralize(hours, "hour", "hours")} and ${pluralize(minutes, "minute", "minutes")}`;
}

function formatFutureAvailabilityCountdown(secondsRemaining) {
  const safe = Math.max(0, Math.floor(secondsRemaining));
  if (safe < 60) {
    return pluralize(safe, "second", "seconds");
  }

  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const parts = [];

  if (days > 0) {
    parts.push(pluralize(days, "day", "days"));
  }
  if (hours > 0) {
    parts.push(pluralize(hours, "hour", "hours"));
  }
  if (minutes > 0) {
    parts.push(pluralize(minutes, "minute", "minutes"));
  }

  if (parts.length === 0) {
    return pluralize(Math.max(1, safe), "second", "seconds");
  }
  return parts.join(", ");
}

function secondsUntilNextLocalMidnight(now = new Date()) {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  );
  return (nextMidnight.getTime() - now.getTime()) / 1000;
}

function initCountdown() {
  const el = document.getElementById("next-poem-countdown");
  if (!el) {
    return;
  }

  const render = () => {
    const remaining = secondsUntilNextLocalMidnight(new Date());
    el.textContent = formatCountdown(remaining);
  };

  render();
  window.setInterval(render, 1000);
}

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
      const render = () => {
        const secondsLeft = (availableAt.getTime() - Date.now()) / 1000;
        if (secondsLeft <= 0) {
          window.location.reload();
          return;
        }
        countdownEl.textContent = formatFutureAvailabilityCountdown(secondsLeft);
      };
      render();
      window.setInterval(render, 1000);
    }
  }
  markReady();
}

function selectPoemForDate(poems, dateStr) {
  let visibleCount = 0;
  let current = null;

  for (let i = 0; i < poems.length; i += 1) {
    const poem = poems[i];
    if (poem.date <= dateStr) {
      visibleCount = i + 1;
      if (poem.date === dateStr) {
        current = poem;
      }
    }
  }

  if (!current && visibleCount > 0) {
    current = poems[visibleCount - 1];
  }

  return {
    visible: poems.slice(0, visibleCount),
    current
  };
}

function groupByYearMonth(poems) {
  const grouped = new Map();
  const sorted = poems.slice().sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  for (const poem of sorted) {
    const parts = poem.dateParts || {};
    const year = String(parts.year || "");
    const month = String(parts.month || "");
    if (!year || !month) {
      continue;
    }
    if (!grouped.has(year)) {
      grouped.set(year, new Map());
    }
    const yearMap = grouped.get(year);
    if (!yearMap.has(month)) {
      yearMap.set(month, []);
    }
    yearMap.get(month).push(poem);
  }
  return grouped;
}

const authorCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function normalizedAlphaText(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function authorInitial(author) {
  const normalized = normalizedAlphaText(author);
  const firstChar = normalized.charAt(0).toUpperCase();
  return /^[A-Z]$/.test(firstChar) ? firstChar : "#";
}

function groupByAuthorInitial(poems) {
  const grouped = new Map();
  const sorted = poems
    .slice()
    .sort((a, b) => authorCollator.compare(a.author, b.author) || b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

  for (const poem of sorted) {
    const author = String(poem.author || "").trim() || "Unknown";
    const initial = authorInitial(author);
    if (!grouped.has(initial)) {
      grouped.set(initial, new Map());
    }
    const authorsMap = grouped.get(initial);
    if (!authorsMap.has(author)) {
      authorsMap.set(author, []);
    }
    authorsMap.get(author).push(poem);
  }

  for (const authorsMap of grouped.values()) {
    for (const poemsByAuthor of authorsMap.values()) {
      poemsByAuthor.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
    }
  }

  return grouped;
}

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
  const years = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));
  const currentYear = effectiveDate.slice(0, 4);
  const currentMonth = effectiveDate.slice(5, 7);

  treeEl.innerHTML = years
    .map((year) => {
      const monthsMap = grouped.get(year);
      const months = Array.from(monthsMap.keys()).sort((a, b) => b.localeCompare(a));
      const yearOpen = year === currentYear ? " open" : "";
      const defaultOpenMonth = year === currentYear ? (months.includes(currentMonth) ? currentMonth : months[0] || "") : "";
      const monthBlocks = months
        .map((month) => {
          const poemsInMonth = monthsMap.get(month);
          const monthOpen = year === currentYear && month === defaultOpenMonth ? " open" : "";
          const rows = poemsInMonth
            .map((poem) => {
              const day = escapeHtml(String(poem.dateParts?.day || "--"));
              const href = `../${poem.route.slice(1)}/`;
              return `<li><span class="archive-day">${day}</span><span aria-hidden="true">&middot;</span><a href="${escapeHtml(href)}">${escapeHtml(poem.title)}</a></li>`;
            })
            .join("");
          return `<details class="archive-month"${monthOpen}><summary>${escapeHtml(monthLabel(month))}</summary><ul class="archive-poems">${rows}</ul></details>`;
        })
        .join("");
      return `<details class="archive-year"${yearOpen}><summary>${escapeHtml(year)}</summary><div class="archive-months">${monthBlocks}</div></details>`;
    })
    .join("");
}

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
    return authorCollator.compare(a, b);
  });

  treeEl.innerHTML = letters
    .map((letter) => {
      const authorsMap = grouped.get(letter);
      const authors = Array.from(authorsMap.keys()).sort((a, b) => authorCollator.compare(a, b));
      const poetBlocks = authors
        .map((author) => {
          const poemsByAuthor = authorsMap.get(author);
          const countLabel = poemsByAuthor.length === 1 ? "1 poem" : `${poemsByAuthor.length} poems`;
          const rows = poemsByAuthor
            .map((poem) => {
              const href = `../${poem.route.slice(1)}/`;
              return `<li><span aria-hidden="true" class="poet-separator">&middot;</span><a href="${escapeHtml(href)}">${escapeHtml(poem.title)}</a></li>`;
            })
            .join("");
          return `<details class="archive-month poet-group"><summary><span class="poet-name">${escapeHtml(author)}</span><span aria-hidden="true" class="poet-separator">&middot;</span><span class="poet-count">${escapeHtml(countLabel)}</span></summary><ul class="archive-poems poet-poems">${rows}</ul></details>`;
        })
        .join("");
      return `<details class="archive-year poet-letter"><summary>${escapeHtml(letter)}</summary><div class="archive-months poet-groups">${poetBlocks}</div></details>`;
    })
    .join("");
}

async function loadPoemsData() {
  const response = await fetch(poemsDataPath());
  if (!response.ok) {
    throw new Error(`Could not load poems data (${response.status}).`);
  }
  return response.json();
}

async function init() {
  initCountdown();
  initPoemAccessGuard();

  const hasHomeView = Boolean(document.getElementById("home-content"));
  const hasArchiveView = Boolean(document.getElementById("archive-tree"));
  const hasPoetsView = Boolean(document.getElementById("poets-tree"));
  const dynamicMain = document.querySelector('main[data-dynamic-page="1"]');
  const markReady = () => {
    if (dynamicMain) {
      dynamicMain.setAttribute("data-ready", "1");
    }
  };
  if (!hasHomeView && !hasArchiveView && !hasPoetsView) {
    return;
  }

  try {
    const poems = await loadPoemsData();
    const defaultAsOf = dynamicMain?.dataset?.defaultAsOf || "";
    const effectiveDate = effectiveDateFromQueryOrNow({ defaultAsOf });
    if (hasHomeView) {
      renderHome(poems, effectiveDate);
    }
    if (hasArchiveView) {
      renderArchive(poems, effectiveDate);
    }
    if (hasPoetsView) {
      renderPoets(poems, effectiveDate);
    }
  } catch (error) {
    const target = document.querySelector("#home-content, #archive-tree, #poets-tree");
    if (target) {
      target.innerHTML = `<p class="empty">${escapeHtml(error.message || "Failed to load poems.")}</p>`;
    }
  } finally {
    markReady();
  }
}

void init();
