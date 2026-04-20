import {
  formatPoetIndexLabel,
  poetInitial,
  sortPoetInitials,
  sortPoets
} from "./poet-utils.mjs";

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function poetSummariesByInitial(poems) {
  const grouped = new Map();

  for (const poem of poems) {
    const poet = String(poem.poet || "").trim() || "Unknown";
    const initial = poetInitial(poet);
    if (!grouped.has(initial)) {
      grouped.set(initial, new Map());
    }
    const poetsMap = grouped.get(initial);
    if (!poetsMap.has(poet)) {
      poetsMap.set(poet, {
        poet,
        route: String(poem.poetRoute || "").trim(),
        count: 0
      });
    }
    const summary = poetsMap.get(poet);
    summary.count += 1;
    if (!summary.route && poem.poetRoute) {
      summary.route = String(poem.poetRoute).trim();
    }
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

function renderPoetEntry(summary) {
  const label = formatPoetIndexLabel(summary.poet);
  const poetLabel = summary.route
    ? `<a href="${escapeHtml(routeHref(summary.route))}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
  const countLabel = summary.count > 0 ? `<span class="poet-count">(${escapeHtml(summary.count)})</span>` : "";
  return `<li class="poet-authors-item">${poetLabel}${countLabel}</li>`;
}

export function renderPoetsIndex(poems) {
  const visiblePoems = Array.isArray(poems) ? poems : [];
  if (visiblePoems.length === 0) {
    return "<p>No published poets yet.</p>";
  }

  const grouped = poetSummariesByInitial(visiblePoems);
  const letters = sortPoetInitials(grouped.keys());

  const letterNav = `<nav class="poets-letter-nav" aria-label="Poet initials">${letters
    .map((letter) => `<a href="/poets#${escapeHtml(poetInitialId(letter))}">${escapeHtml(letter)}</a>`)
    .join("")}</nav>`;

  const directory = letters
    .map((letter) => {
      const poetsMap = grouped.get(letter);
      const poetBlocks = sortPoets(poetsMap.keys())
        .map((poet) => renderPoetEntry(poetsMap.get(poet)))
        .join("");
      return `<section id="${escapeHtml(poetInitialId(letter))}" class="poet-letter"><h3>${escapeHtml(letter)}</h3><ul class="poet-authors">${poetBlocks}</ul></section>`;
    })
    .join("");

  return `${letterNav}<div class="poets-letter-groups">${directory}</div>`;
}
