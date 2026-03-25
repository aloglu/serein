import { mkdir, readdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { expectedPoemFilenameWithExtension } from "./poem-filenames.mjs";
import { repairMojibakeText as repairWindows1252MojibakeText } from "./mojibake.mjs";

const root = process.cwd();
const poemsDir = path.join(root, "poems");
const PUBLICATION_TIME_ZONE = "Europe/Istanbul";
const TYPOGRAPHY_FRONTMATTER_FIELDS = new Set(["title", "author", "translator", "publication"]);
const REQUIRED_FRONTMATTER_FIELDS = new Set(["title", "author", "date"]);
const FRONTMATTER_FIELD_ORDER = ["title", "author", "translator", "publication", "source", "date", "tts"];
const ELISION_WORD_RE = /^(?:\d{2,4}(?:s)?\b|cause\b|cuz\b|em\b|gainst\b|neath\b|round\b|til\b|tis\b|twas\b|tween\b|twere\b|twill\b|n\b)/i;
const LEFT_SINGLE_QUOTE = "\u2018";
const RIGHT_SINGLE_QUOTE = "\u2019";
const LEFT_DOUBLE_QUOTE = "\u201C";
const RIGHT_DOUBLE_QUOTE = "\u201D";
const ELLIPSIS = "\u2026";
const EN_DASH = "\u2013";
const EM_DASH = "\u2014";
const MONTH_NAME_TO_NUMBER = new Map([
  ["january", "01"],
  ["jan", "01"],
  ["february", "02"],
  ["feb", "02"],
  ["march", "03"],
  ["mar", "03"],
  ["april", "04"],
  ["apr", "04"],
  ["may", "05"],
  ["june", "06"],
  ["jun", "06"],
  ["july", "07"],
  ["jul", "07"],
  ["august", "08"],
  ["aug", "08"],
  ["september", "09"],
  ["sep", "09"],
  ["sept", "09"],
  ["october", "10"],
  ["oct", "10"],
  ["november", "11"],
  ["nov", "11"],
  ["december", "12"],
  ["dec", "12"]
]);

function normalizeNewlines(input) {
  return String(input || "").replace(/\r\n/g, "\n");
}

function repairMojibakePunctuation(input) {
  return String(input || "")
    .replaceAll("â€™", RIGHT_SINGLE_QUOTE)
    .replaceAll("â€˜", LEFT_SINGLE_QUOTE)
    .replaceAll("â€œ", LEFT_DOUBLE_QUOTE)
    .replaceAll("â€\u009d", RIGHT_DOUBLE_QUOTE)
    .replaceAll("â€¦", ELLIPSIS)
    .replaceAll("â€”", EM_DASH)
    .replaceAll("â€“", EN_DASH)
    .replaceAll("\u00c2\u00a0", "\u00a0");
}

function detectLineEnding(input) {
  return String(input || "").includes("\r\n") ? "\r\n" : "\n";
}

function repairMojibakeText(input) {
  return repairWindows1252MojibakeText(input);
  const source = String(input || "");
  if (!/[ÃÂâ]/.test(source)) {
    return source;
  }

  try {
    const repaired = Buffer.from(source, "latin1").toString("utf8");
    if (!repaired || repaired.includes("\uFFFD")) {
      return source;
    }
    return repaired.replaceAll("\u00c2\u00a0", "\u00a0");
  } catch {
    return source;
  }
}

function stripWrappingQuotes(input) {
  const raw = String(input || "").trim();
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\");
  }
  if (
    (raw.startsWith(LEFT_DOUBLE_QUOTE) && raw.endsWith(RIGHT_DOUBLE_QUOTE))
    || (raw.startsWith(LEFT_SINGLE_QUOTE) && raw.endsWith(RIGHT_SINGLE_QUOTE))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function isWordChar(char) {
  return Boolean(char) && /[\p{L}\p{N}]/u.test(char);
}

function isWhitespace(char) {
  return !char || /\s/u.test(char);
}

function isOpeningBoundary(char) {
  return isWhitespace(char) || /[([{<]/.test(char) || char === EM_DASH || char === EN_DASH;
}

function isClosingBoundary(char) {
  return isWhitespace(char) || /[)\]}>.,!?;:]/.test(char) || char === EM_DASH || char === EN_DASH;
}

function startsElisionWord(source, apostropheIndex) {
  return ELISION_WORD_RE.test(source.slice(apostropheIndex + 1));
}

function normalizeSingleQuotes(source) {
  let output = "";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char !== "'") {
      output += char;
      continue;
    }

    const previous = source[index - 1] || "";
    const next = source[index + 1] || "";

    if (isWordChar(previous) && isWordChar(next)) {
      output += RIGHT_SINGLE_QUOTE;
      continue;
    }

    if (isWordChar(previous) && !isWordChar(next)) {
      output += RIGHT_SINGLE_QUOTE;
      continue;
    }

    if (!isWordChar(previous) && isWordChar(next)) {
      output += startsElisionWord(source, index) ? RIGHT_SINGLE_QUOTE : LEFT_SINGLE_QUOTE;
      continue;
    }

    if (isOpeningBoundary(previous) && !isClosingBoundary(next)) {
      output += LEFT_SINGLE_QUOTE;
      continue;
    }

    if (!isOpeningBoundary(previous) && isClosingBoundary(next)) {
      output += RIGHT_SINGLE_QUOTE;
      continue;
    }

    output += RIGHT_SINGLE_QUOTE;
  }

  return output;
}

function normalizeDoubleQuotes(source) {
  let output = "";
  let open = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char !== '"') {
      output += char;
      continue;
    }

    const previous = source[index - 1] || "";
    const next = source[index + 1] || "";
    const openingContext = isOpeningBoundary(previous);
    const closingContext = isClosingBoundary(next);

    if (openingContext && !closingContext) {
      output += LEFT_DOUBLE_QUOTE;
      open = true;
      continue;
    }

    if (!openingContext && closingContext) {
      output += RIGHT_DOUBLE_QUOTE;
      open = false;
      continue;
    }

    output += open ? RIGHT_DOUBLE_QUOTE : LEFT_DOUBLE_QUOTE;
    open = !open;
  }

  return output;
}

function normalizeTypography(input, { transformDoubleQuotes = true } = {}) {
  const withBasicPunctuation = normalizeSingleQuotes(
    repairMojibakeText(input)
      .replace(/\.\.\./g, ELLIPSIS)
      .replace(/(?<!-)--(?!-)/g, EM_DASH)
  );

  if (!transformDoubleQuotes) {
    return withBasicPunctuation;
  }

  return normalizeDoubleQuotes(withBasicPunctuation);
}

function normalizePoemTypography(rawContent, filename) {
  const source = normalizeNewlines(rawContent);
  const lineEnding = detectLineEnding(rawContent);
  const lines = source.split("\n");

  if (lines[0]?.trim() !== "---") {
    throw new Error(`Missing frontmatter in ${filename}. Expected file to start with '---'.`);
  }

  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      endIndex = index;
      break;
    }
  }

  if (endIndex < 0) {
    throw new Error(`Unterminated frontmatter in ${filename}. Missing closing '---'.`);
  }

  const normalizedLines = [...lines];
  for (let index = 1; index < endIndex; index += 1) {
    const line = lines[index];
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*)(:\s*)(.*)$/);
    if (!kv) {
      continue;
    }

    const key = kv[1].toLowerCase();
    if (!TYPOGRAPHY_FRONTMATTER_FIELDS.has(key)) {
      continue;
    }

    const normalizedValue = normalizeTypography(kv[3], { transformDoubleQuotes: false });
    if (normalizedValue !== kv[3]) {
      normalizedLines[index] = `${kv[1]}${kv[2]}${normalizedValue}`;
    }
  }

  const poemBody = lines.slice(endIndex + 1).join("\n");
  const normalizedBody = normalizeTypography(poemBody);
  if (normalizedBody !== poemBody) {
    normalizedLines.splice(endIndex + 1, normalizedLines.length - (endIndex + 1), ...normalizedBody.split("\n"));
  }

  return normalizedLines.join(lineEnding);
}

function normalizePoemFields(poem) {
  return {
    ...poem,
    title: normalizeTypography(poem.title, { transformDoubleQuotes: false }),
    author: normalizeTypography(poem.author, { transformDoubleQuotes: false }),
    translator: normalizeTypography(poem.translator, { transformDoubleQuotes: false }),
    publication: normalizeTypography(poem.publication, { transformDoubleQuotes: false }),
    tts: normalizeTtsValue(poem.tts || poem.tty),
    poem: normalizeTypography(poem.poem)
  };
}

function normalizeTtsValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "no" ? "no" : "yes";
}

function needsFrontmatterQuoting(value) {
  return /:\s/.test(value) || /^\s|\s$/.test(value);
}

function serializeFrontmatterValue(value) {
  const raw = String(value ?? "").trim();
  if (!needsFrontmatterQuoting(raw)) {
    return raw;
  }
  if (!raw.includes('"')) {
    return `"${raw}"`;
  }
  if (!raw.includes("'")) {
    return `'${raw}'`;
  }
  return `"${raw.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function renderNormalizedPoemMarkdown(poem, lineEnding = "\n") {
  const frontmatterLines = ["---"];

  for (const field of FRONTMATTER_FIELD_ORDER) {
    const value = String(poem?.[field] ?? "").trim();
    if (!value && !REQUIRED_FRONTMATTER_FIELDS.has(field)) {
      continue;
    }
    frontmatterLines.push(`${field}: ${serializeFrontmatterValue(value)}`);
  }

  frontmatterLines.push("---");

  const body = normalizeNewlines(poem?.poem || "")
    .replace(/^\n+/, "")
    .replace(/\n+$/g, "");
  if (!body) {
    return `${frontmatterLines.join(lineEnding)}${lineEnding}`;
  }

  return `${frontmatterLines.join(lineEnding)}${lineEnding}${lineEnding}${body.split("\n").join(lineEnding)}${lineEnding}`;
}

function parsePoemMarkdownFile(rawContent, filename) {
  const source = normalizeNewlines(rawContent);
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new Error(`Missing frontmatter in ${filename}. Expected file to start with '---'.`);
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }
  if (endIndex < 0) {
    throw new Error(`Unterminated frontmatter in ${filename}. Missing closing '---'.`);
  }

  const poem = {
    title: "",
    author: "",
    translator: "",
    publication: "",
    date: "",
    source: "",
    tts: "",
    tty: "",
    poem: ""
  };

  const metaLines = lines.slice(1, endIndex);

  for (const line of metaLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) {
      continue;
    }

    const key = kv[1].toLowerCase();
    const value = kv[2];

    if (key in poem && key !== "poem") {
      poem[key] = stripWrappingQuotes(value);
    }
  }

  if (!poem.tts && poem.tty) {
    poem.tts = poem.tty;
  }
  poem.tty = "";

  poem.poem = lines.slice(endIndex + 1).join("\n").replace(/^\n+/, "");
  return poem;
}

function parseDateParts(yyyyMmDd) {
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

function addDaysToYyyyMmDd(yyyyMmDd, dayCount) {
  const parts = parseDateParts(yyyyMmDd);
  if (!parts || !Number.isInteger(dayCount)) {
    return "";
  }

  const dt = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  dt.setUTCDate(dt.getUTCDate() + dayCount);
  return dt.toISOString().slice(0, 10);
}

function yyyyMmDdInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function monthNumberFromToken(token) {
  const normalized = String(token || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (/^(?:0?[1-9]|1[0-2])$/.test(normalized)) {
    return String(Number(normalized)).padStart(2, "0");
  }

  return MONTH_NAME_TO_NUMBER.get(normalized) || "";
}

function describeDateDirective(rawDate) {
  const value = String(rawDate || "").trim();
  if (parseDateParts(value)) {
    return {
      type: "concrete",
      raw: value
    };
  }

  if (value.toLowerCase() === "next") {
    return {
      type: "next",
      raw: value
    };
  }

  const randomMonthMatch = value.match(/^random-(.+)$/i);
  if (randomMonthMatch) {
    const month = monthNumberFromToken(randomMonthMatch[1]);
    if (month) {
      return {
        type: "random-month",
        raw: value,
        month
      };
    }
    return {
      type: "invalid-random-month",
      raw: value
    };
  }

  return {
    type: "invalid",
    raw: value
  };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
}

function listAvailableDatesForMonth(year, month, reservedDates) {
  const available = [];
  const totalDays = daysInMonth(year, month);

  for (let day = 1; day <= totalDays; day += 1) {
    const candidate = `${year}-${month}-${String(day).padStart(2, "0")}`;
    if (!reservedDates.has(candidate)) {
      available.push(candidate);
    }
  }

  return available;
}

function findNextAvailableDateAfter(cursorDate, reservedDates) {
  let candidate = addDaysToYyyyMmDd(cursorDate, 1);

  while (reservedDates.has(candidate)) {
    candidate = addDaysToYyyyMmDd(candidate, 1);
  }

  return candidate;
}

function monthFolderName(monthNumber) {
  const month = Number(monthNumber);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return "";
  }
  const label = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, month - 1, 1))
  );
  return `${String(month).padStart(2, "0")}-${label}`;
}

function expectedPoemSubdirForDate(yyyyMmDd) {
  const parts = parseDateParts(yyyyMmDd);
  if (!parts) {
    return null;
  }
  const monthFolder = monthFolderName(parts.month);
  if (!monthFolder) {
    return null;
  }
  return path.join(parts.year, monthFolder);
}

async function collectPoemFiles(dirPath, relDir = "") {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relPath = relDir ? path.join(relDir, entry.name) : entry.name;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectPoemFiles(fullPath, relPath);
      files.push(...nested);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    files.push({
      name: entry.name,
      relPath,
      fullPath
    });
  }

  return files;
}

async function parsePoemEntry(file) {
  const raw = await readFile(file.fullPath, "utf8");
  const lineEnding = detectLineEnding(raw);
  const normalizedContent = normalizePoemTypography(raw, file.relPath);
  const poem = normalizePoemFields(parsePoemMarkdownFile(normalizedContent, file.relPath));
  return {
    poem,
    lineEnding,
    currentRelPath: file.relPath,
    fullPath: file.fullPath,
    rawContent: raw,
    typographyNormalizedContent: normalizedContent,
    initialNormalizedContent: renderNormalizedPoemMarkdown(poem, lineEnding),
    normalizedContent: renderNormalizedPoemMarkdown(poem, lineEnding),
    originalDate: poem.date
  };
}

function applyResolvedDateToEntry(entry, resolvedDate) {
  if (entry.poem.date === resolvedDate) {
    return;
  }

  entry.poem.date = resolvedDate;
  entry.normalizedContent = renderNormalizedPoemMarkdown(entry.poem, entry.lineEnding);
}

function resolvePoemDateDirectives(entries) {
  const sortedEntries = [...entries].sort((left, right) => left.currentRelPath.localeCompare(right.currentRelPath));
  const reservedDates = new Set();

  for (const entry of sortedEntries) {
    const directive = describeDateDirective(entry.poem.date);
    entry.dateDirective = directive;

    if (directive.type === "concrete") {
      reservedDates.add(directive.raw);
      continue;
    }

    if (directive.type === "next" || directive.type === "random-month") {
      continue;
    }

    throw new Error(
      `Invalid date '${entry.poem.date}' in ${entry.currentRelPath}. Expected YYYY-MM-DD, 'next', or 'random-<month>' (for example 'random-may').`
    );
  }

  const publicationToday = yyyyMmDdInTimeZone(PUBLICATION_TIME_ZONE);
  let nextDateCursor = addDaysToYyyyMmDd(publicationToday, -1);
  for (const entry of sortedEntries) {
    if (entry.dateDirective.type !== "next") {
      continue;
    }

    const resolvedDate = findNextAvailableDateAfter(nextDateCursor, reservedDates);
    reservedDates.add(resolvedDate);
    nextDateCursor = resolvedDate;
    applyResolvedDateToEntry(entry, resolvedDate);
  }

  const publicationYear = publicationToday.slice(0, 4);
  for (const entry of sortedEntries) {
    if (entry.dateDirective.type !== "random-month") {
      continue;
    }

    const availableDates = listAvailableDatesForMonth(publicationYear, entry.dateDirective.month, reservedDates);
    if (availableDates.length === 0) {
      throw new Error(
        `Cannot resolve date '${entry.poem.date}' in ${entry.currentRelPath}. No available dates remain in ${publicationYear}-${entry.dateDirective.month}.`
      );
    }

    const resolvedDate = availableDates[Math.floor(Math.random() * availableDates.length)];
    reservedDates.add(resolvedDate);
    applyResolvedDateToEntry(entry, resolvedDate);
  }
}

async function removeEmptyPoemDirs(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const child = path.join(dirPath, entry.name);
    await removeEmptyPoemDirs(child);
  }

  if (dirPath === poemsDir) {
    return;
  }

  const after = await readdir(dirPath, { withFileTypes: true });
  if (after.length === 0) {
    const retryDelaysMs = [50, 100, 250];

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      try {
        await rmdir(dirPath);
        return;
      } catch (error) {
        const code = String(error?.code || "");
        if (code === "ENOENT") {
          return;
        }
        if (!["EBUSY", "ENOTEMPTY", "EPERM", "UNKNOWN"].includes(code)) {
          throw error;
        }
        if (attempt === retryDelaysMs.length) {
          return;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }
  }
}

export async function normalizePoems() {
  const entries = await collectPoemFiles(poemsDir);
  entries.sort((left, right) => left.relPath.localeCompare(right.relPath));
  const poems = [];

  for (const entry of entries) {
    const parsed = await parsePoemEntry(entry);
    poems.push(parsed);
  }

  resolvePoemDateDirectives(poems);

  for (const item of poems) {
    const expected = expectedPoemFilenameWithExtension(item.poem, ".md");
    if (!expected) {
      throw new Error(`Cannot normalize '${item.currentRelPath}': missing/invalid date or title.`);
    }
    const expectedSubdir = expectedPoemSubdirForDate(item.poem.date);
    if (!expectedSubdir) {
      throw new Error(`Cannot normalize '${item.currentRelPath}': missing/invalid date.`);
    }
    item.expectedFilename = expected;
    item.expectedRelPath = path.join(expectedSubdir, expected);
  }

  const expectedPaths = new Map();
  for (const item of poems) {
    if (expectedPaths.has(item.expectedRelPath) && expectedPaths.get(item.expectedRelPath) !== item.currentRelPath) {
      throw new Error(
        `Path collision: '${item.currentRelPath}' and '${expectedPaths.get(item.expectedRelPath)}' both map to '${item.expectedRelPath}'.`
      );
    }
    expectedPaths.set(item.expectedRelPath, item.currentRelPath);
  }

  let renamed = 0;
  let frontmatterUpdated = 0;
  let typographyUpdated = 0;
  let datesResolved = 0;
  for (const item of poems) {
    const expectedPath = path.join(poemsDir, item.expectedRelPath);
    const needsRename = item.currentRelPath !== item.expectedRelPath;
    const needsTypographyUpdate = item.rawContent !== item.typographyNormalizedContent;
    const needsFrontmatterUpdate = item.typographyNormalizedContent !== item.initialNormalizedContent;
    const needsDateUpdate = item.originalDate !== item.poem.date;
    const needsContentUpdate = needsTypographyUpdate || needsFrontmatterUpdate || needsDateUpdate;

    if (!needsRename && !needsContentUpdate) {
      continue;
    }

    let targetPath = item.fullPath;
    if (needsRename) {
      await mkdir(path.dirname(expectedPath), { recursive: true });
      await rename(item.fullPath, expectedPath);
      targetPath = expectedPath;
      renamed += 1;
    }

    if (needsContentUpdate) {
      await writeFile(targetPath, item.normalizedContent, "utf8");
    }

    if (needsTypographyUpdate) {
      typographyUpdated += 1;
    }
    if (needsFrontmatterUpdate) {
      frontmatterUpdated += 1;
    }
    if (needsDateUpdate) {
      datesResolved += 1;
    }

    const updateKinds = [];
    if (needsDateUpdate) {
      updateKinds.push("date");
    }
    if (needsFrontmatterUpdate) {
      updateKinds.push("frontmatter");
    }
    if (needsTypographyUpdate) {
      updateKinds.push("typography");
    }

    if (needsRename && updateKinds.length > 0) {
      console.log(`normalized: ${item.currentRelPath} -> ${item.expectedRelPath} (path + ${updateKinds.join(" + ")})`);
      continue;
    }

    if (needsRename) {
      console.log(`moved: ${item.currentRelPath} -> ${item.expectedRelPath}`);
      continue;
    }

    if (updateKinds.length > 1) {
      console.log(`updated: ${item.currentRelPath} (${updateKinds.join(" + ")})`);
      continue;
    }

    if (needsDateUpdate) {
      console.log(`date: ${item.currentRelPath} -> ${item.poem.date}`);
      continue;
    }

    if (needsFrontmatterUpdate) {
      console.log(`frontmatter: ${item.currentRelPath}`);
      continue;
    }

    console.log(`typography: ${item.currentRelPath}`);
  }

  if (renamed > 0) {
    await removeEmptyPoemDirs(poemsDir);
  }

  if (renamed === 0 && frontmatterUpdated === 0 && typographyUpdated === 0 && datesResolved === 0) {
    console.log("No poem path/filename, frontmatter, date, or typography changes needed.");
    return;
  }

  const summary = [];
  if (renamed > 0) {
    summary.push(`renamed ${renamed} poem file(s)`);
  }
  if (datesResolved > 0) {
    summary.push(`resolved ${datesResolved} symbolic date(s)`);
  }
  if (frontmatterUpdated > 0) {
    summary.push(`cleaned frontmatter in ${frontmatterUpdated} poem file(s)`);
  }
  if (typographyUpdated > 0) {
    summary.push(`updated typography in ${typographyUpdated} poem file(s)`);
  }
  console.log(`Completed: ${summary.join("; ")}.`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await normalizePoems();
}
