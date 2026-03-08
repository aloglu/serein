export function runtimeAsOfEnabled() {
  return document.documentElement.dataset.runtimeAsOfEnabled === "1";
}

export function localDateString(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateParts(yyyyMmDd) {
  const match = String(yyyyMmDd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return {
    year: match[1],
    month: match[2],
    day: match[3]
  };
}

export function effectiveDateFromQueryOrNow({ allowQueryOverride = runtimeAsOfEnabled(), defaultAsOf = "" } = {}) {
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

export function monthLabel(monthNumber) {
  const month = Number(monthNumber);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return String(monthNumber || "");
  }
  const dt = new Date(Date.UTC(2024, month - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(dt);
}

export function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function loadJsonData(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load poems data (${response.status}).`);
  }
  return response.json();
}

export function selectPoemForDate(poems, dateStr) {
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

export function compareAuthors(left, right) {
  return authorCollator.compare(left, right);
}

export function groupByYearMonth(poems) {
  const grouped = new Map();
  const sorted = poems.slice().sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

  for (const poem of sorted) {
    const parts = parseDateParts(poem.date) || {};
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

export function groupByAuthorInitial(poems) {
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
