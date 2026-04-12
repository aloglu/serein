import path from "node:path";

export const POET_COOLDOWN_DAYS = 30;
export const POET_MINIMUM_SPACING_DAYS = POET_COOLDOWN_DAYS + 1;

function parseDateParts(yyyyMmDd) {
  const match = String(yyyyMmDd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function dateToUtcTime(yyyyMmDd) {
  const parts = parseDateParts(yyyyMmDd);
  if (!parts) {
    return null;
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

export function addDaysToYyyyMmDd(yyyyMmDd, days) {
  const time = dateToUtcTime(yyyyMmDd);
  if (time === null) {
    throw new Error(`Expected a YYYY-MM-DD date, received '${yyyyMmDd}'`);
  }
  const dt = new Date(time);
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return dt.toISOString().slice(0, 10);
}

export function daysBetweenYyyyMmDd(leftDate, rightDate) {
  const leftTime = dateToUtcTime(leftDate);
  const rightTime = dateToUtcTime(rightDate);
  if (leftTime === null || rightTime === null) {
    return null;
  }
  return Math.round((rightTime - leftTime) / 86400000);
}

function summary(poem) {
  return {
    date: poem.date,
    title: poem.title,
    poet: poem.poet,
    filepath: poem.filepath
  };
}

function shellQuote(arg) {
  const value = String(arg || "");
  if (/^[A-Za-z0-9_./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildPoetProximityFixCommand(filepath) {
  return `serein poems fix-proximity ${shellQuote(filepath)}`;
}

export function findPoetProximityIssues(poems, { cooldownDays = POET_COOLDOWN_DAYS, asOfDate = "" } = {}) {
  const poemsByPoet = new Map();

  for (const poem of poems) {
    const poet = String(poem?.poet || "").trim();
    const date = String(poem?.date || "").trim();
    if (!poet || !parseDateParts(date)) {
      continue;
    }
    if (!poemsByPoet.has(poet)) {
      poemsByPoet.set(poet, []);
    }
    poemsByPoet.get(poet).push(poem);
  }

  const issues = [];
  for (const [poet, poetPoems] of poemsByPoet.entries()) {
    const sorted = poetPoems
      .slice()
      .sort((left, right) => left.date.localeCompare(right.date) || String(left.filepath || "").localeCompare(String(right.filepath || "")));

    for (let index = 1; index < sorted.length; index += 1) {
      const earlier = sorted[index - 1];
      const later = sorted[index];
      const daysApart = daysBetweenYyyyMmDd(earlier.date, later.date);
      if (daysApart === null || daysApart > cooldownDays) {
        continue;
      }

      const earlierPublished = asOfDate && earlier.date <= asOfDate;
      const laterPublished = asOfDate && later.date <= asOfDate;
      const actionable = Boolean(asOfDate && !laterPublished);
      const earliestAllowedDate = addDaysToYyyyMmDd(earlier.date, cooldownDays + 1);
      issues.push({
        poet,
        cooldownDays,
        minimumSpacingDays: cooldownDays + 1,
        daysApart,
        earlier: summary(earlier),
        later: summary(later),
        earliestAllowedDate,
        actionable,
        state: earlierPublished && laterPublished
          ? "published"
          : earlierPublished
            ? "published/upcoming"
            : "upcoming",
        fixCommand: actionable ? buildPoetProximityFixCommand(later.filepath) : ""
      });
    }
  }

  return issues.sort((left, right) => (
    left.later.date.localeCompare(right.later.date)
    || left.poet.localeCompare(right.poet)
    || String(left.later.filepath || "").localeCompare(String(right.later.filepath || ""))
  ));
}

export function isPoetDateAvailable(candidateDate, poet, poems, {
  cooldownDays = POET_COOLDOWN_DAYS,
  ignoreFilepaths = new Set()
} = {}) {
  const candidateTime = dateToUtcTime(candidateDate);
  if (candidateTime === null) {
    return false;
  }

  for (const poem of poems) {
    if (String(poem?.poet || "").trim() !== poet) {
      continue;
    }
    if (ignoreFilepaths.has(String(poem?.filepath || ""))) {
      continue;
    }
    const poemTime = dateToUtcTime(poem?.date);
    if (poemTime === null) {
      continue;
    }
    const daysApart = Math.abs(Math.round((candidateTime - poemTime) / 86400000));
    if (daysApart <= cooldownDays) {
      return false;
    }
  }

  return true;
}

export function findNextAvailableDateForPoet(startDate, poet, poems, {
  cooldownDays = POET_COOLDOWN_DAYS,
  occupiedDates = new Set(),
  ignoreFilepaths = new Set()
} = {}) {
  let candidate = String(startDate || "").trim();
  if (!parseDateParts(candidate)) {
    throw new Error(`Expected a YYYY-MM-DD date, received '${startDate}'`);
  }

  while (
    occupiedDates.has(candidate)
    || !isPoetDateAvailable(candidate, poet, poems, { cooldownDays, ignoreFilepaths })
  ) {
    candidate = addDaysToYyyyMmDd(candidate, 1);
  }

  return candidate;
}

export function normalizePoetProximityTargetPath(targetPath) {
  let normalized = String(targetPath || "").trim();
  if (!normalized) {
    return "";
  }
  normalized = normalized.replace(/^poems[\\/]+/i, "");
  normalized = path.normalize(normalized);
  return normalized;
}

export function planPoetProximityFix(poems, targetPath, { cooldownDays = POET_COOLDOWN_DAYS, asOfDate = "" } = {}) {
  const normalizedTarget = normalizePoetProximityTargetPath(targetPath);
  if (!normalizedTarget) {
    throw new Error("Missing target poem path.");
  }

  const issues = findPoetProximityIssues(poems, { cooldownDays, asOfDate });
  const targetIssue = issues.find((item) => item.later.filepath === normalizedTarget);
  if (!targetIssue) {
    throw new Error(`No poet proximity issue found for '${normalizedTarget}'.`);
  }
  if (!targetIssue.actionable) {
    throw new Error(`Cannot move '${normalizedTarget}' because it is already published.`);
  }

  const targetPoem = poems.find((poem) => poem.filepath === normalizedTarget);
  if (!targetPoem) {
    throw new Error(`Could not find poem '${normalizedTarget}'.`);
  }

  const chain = poems
    .filter((poem) => poem.poet === targetPoem.poet && poem.date >= targetPoem.date)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date) || String(left.filepath || "").localeCompare(String(right.filepath || "")));

  const occupiedDates = new Set(poems.map((poem) => poem.date));
  const moves = [];
  let previousDate = targetIssue.earlier.date;

  for (const poem of chain) {
    const startDate = addDaysToYyyyMmDd(previousDate, cooldownDays + 1);
    let nextDate = startDate;
    while (occupiedDates.has(nextDate)) {
      nextDate = addDaysToYyyyMmDd(nextDate, 1);
    }
    moves.push({
      filepath: poem.filepath,
      title: poem.title,
      poet: poem.poet,
      fromDate: poem.date,
      toDate: nextDate
    });
    occupiedDates.add(nextDate);
    previousDate = nextDate;
  }

  return {
    poet: targetPoem.poet,
    cooldownDays,
    minimumSpacingDays: cooldownDays + 1,
    targetFilepath: normalizedTarget,
    moves
  };
}
