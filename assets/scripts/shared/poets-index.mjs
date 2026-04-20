const poetCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizedAlphaText(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function poetSortParts(poet) {
  const normalized = normalizedAlphaText(poet);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { initialSource: "", primary: "", secondary: "" };
  }

  const primary = tokens[tokens.length - 1];
  const secondary = tokens.slice(0, -1).join(" ");
  return {
    initialSource: primary,
    primary,
    secondary
  };
}

function formatPoetIndexLabel(poet) {
  const raw = String(poet || "").trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) {
    return raw;
  }
  const primary = tokens[tokens.length - 1];
  const secondary = tokens.slice(0, -1).join(" ");
  return `${primary}, ${secondary}`;
}

function poetInitial(poet) {
  const { initialSource } = poetSortParts(poet);
  const firstChar = initialSource.charAt(0).toUpperCase();
  return /^[A-Z]$/.test(firstChar) ? firstChar : "#";
}

function comparePoets(left, right) {
  const leftParts = poetSortParts(left);
  const rightParts = poetSortParts(right);
  return (
    poetCollator.compare(leftParts.primary, rightParts.primary)
    || poetCollator.compare(leftParts.secondary, rightParts.secondary)
    || poetCollator.compare(left, right)
  );
}

function sortPoets(values) {
  return Array.from(values).sort(comparePoets);
}

function comparePoemsByDateDesc(left, right) {
  return right.date.localeCompare(left.date) || left.title.localeCompare(right.title);
}

function comparePoetInitials(left, right) {
  if (left === "#") {
    return 1;
  }
  if (right === "#") {
    return -1;
  }
  return comparePoets(left, right);
}

function sortPoetInitials(values) {
  return Array.from(values).sort(comparePoetInitials);
}

function groupByPoetInitial(poems) {
  const grouped = new Map();
  const sorted = poems
    .slice()
    .sort((a, b) => comparePoets(a.poet, b.poet) || comparePoemsByDateDesc(a, b));

  for (const poem of sorted) {
    const poet = String(poem.poet || "").trim() || "Unknown";
    const initial = poetInitial(poet);
    if (!grouped.has(initial)) {
      grouped.set(initial, new Map());
    }
    const poetsMap = grouped.get(initial);
    if (!poetsMap.has(poet)) {
      poetsMap.set(poet, []);
    }
    poetsMap.get(poet).push(poem);
  }

  return grouped;
}

function poetInitialId(letter) {
  const normalized = String(letter || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "other";
}

function routeHref(routePath) {
  const route = String(routePath || "").trim();
  if (!route) {
    return "";
  }
  return route.endsWith("/") ? route : `${route}/`;
}

function renderPoetEntry(poet, poemsByPoet) {
  const poems = Array.isArray(poemsByPoet) ? poemsByPoet : [];
  const route = poems[0]?.poetRoute || "";
  const label = formatPoetIndexLabel(poet);
  const poetLabel = route
    ? `<a href="${escapeHtml(routeHref(route))}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
  const count = poems.length;
  const countLabel = count > 0 ? `<span class="poet-count">(${escapeHtml(count)})</span>` : "";
  return `<li class="poet-authors-item">${poetLabel}${countLabel}</li>`;
}

export function renderPoetsIndex(poems) {
  const visiblePoems = Array.isArray(poems) ? poems : [];
  if (visiblePoems.length === 0) {
    return "<p>No published poets yet.</p>";
  }

  const grouped = groupByPoetInitial(visiblePoems);
  const letters = sortPoetInitials(grouped.keys());

  const letterNav = `<nav class="poets-letter-nav" aria-label="Poet initials">${letters
    .map((letter) => `<a href="/poets#${escapeHtml(poetInitialId(letter))}">${escapeHtml(letter)}</a>`)
    .join("")}</nav>`;

  const directory = letters
    .map((letter) => {
      const poetsMap = grouped.get(letter);
      const poetBlocks = sortPoets(poetsMap.keys())
        .map((poet) => renderPoetEntry(poet, poetsMap.get(poet)))
        .join("");
      return `<section id="${escapeHtml(poetInitialId(letter))}" class="poet-letter"><h3>${escapeHtml(letter)}</h3><ul class="poet-authors">${poetBlocks}</ul></section>`;
    })
    .join("");

  return `${letterNav}<div class="poets-letter-groups">${directory}</div>`;
}
