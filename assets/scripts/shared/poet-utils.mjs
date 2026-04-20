const poetCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function normalizedAlphaText(input) {
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

export function formatPoetIndexLabel(poet) {
  const raw = String(poet || "").trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) {
    return raw;
  }
  const primary = tokens[tokens.length - 1];
  const secondary = tokens.slice(0, -1).join(" ");
  return `${primary}, ${secondary}`;
}

export function poetInitial(poet) {
  const { initialSource } = poetSortParts(poet);
  const firstChar = initialSource.charAt(0).toUpperCase();
  return /^[A-Z]$/.test(firstChar) ? firstChar : "#";
}

export function comparePoets(left, right) {
  const leftParts = poetSortParts(left);
  const rightParts = poetSortParts(right);
  return (
    poetCollator.compare(leftParts.primary, rightParts.primary)
    || poetCollator.compare(leftParts.secondary, rightParts.secondary)
    || poetCollator.compare(left, right)
  );
}

export function sortPoets(values) {
  return Array.from(values).sort(comparePoets);
}

export function comparePoemsByDateDesc(left, right) {
  return right.date.localeCompare(left.date) || left.title.localeCompare(right.title);
}

export function comparePoetInitials(left, right) {
  if (left === "#") {
    return 1;
  }
  if (right === "#") {
    return -1;
  }
  return comparePoets(left, right);
}

export function sortPoetInitials(values) {
  return Array.from(values).sort(comparePoetInitials);
}

export function groupByPoetInitial(poems) {
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
