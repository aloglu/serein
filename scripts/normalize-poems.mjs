import { mkdir, readdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { expectedPoemFilenameWithExtension } from "./poem-filenames.mjs";

const root = process.cwd();
const poemsDir = path.join(root, "poems");
const TYPOGRAPHY_FRONTMATTER_FIELDS = new Set(["title", "author", "translator", "publication"]);
const ELISION_WORD_RE = /^(?:\d{2,4}(?:s)?\b|cause\b|cuz\b|em\b|gainst\b|neath\b|round\b|til\b|tis\b|twas\b|tween\b|twere\b|twill\b|n\b)/i;
const LEFT_SINGLE_QUOTE = "\u2018";
const RIGHT_SINGLE_QUOTE = "\u2019";
const LEFT_DOUBLE_QUOTE = "\u201C";
const RIGHT_DOUBLE_QUOTE = "\u201D";
const ELLIPSIS = "\u2026";
const EN_DASH = "\u2013";
const EM_DASH = "\u2014";

function normalizeNewlines(input) {
  return String(input || "").replace(/\r\n/g, "\n");
}

function detectLineEnding(input) {
  return String(input || "").includes("\r\n") ? "\r\n" : "\n";
}

function stripWrappingQuotes(input) {
  const raw = String(input || "").trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"'))
    || (raw.startsWith("'") && raw.endsWith("'"))
    || (raw.startsWith(LEFT_DOUBLE_QUOTE) && raw.endsWith(RIGHT_DOUBLE_QUOTE))
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
    String(input || "")
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
    month: match[2]
  };
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
  const normalizedContent = normalizePoemTypography(raw, file.relPath);
  return {
    poem: parsePoemMarkdownFile(normalizedContent, file.relPath),
    currentRelPath: file.relPath,
    fullPath: file.fullPath,
    rawContent: raw,
    normalizedContent
  };
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
    await rmdir(dirPath);
  }
}

async function normalizePoems() {
  const entries = await collectPoemFiles(poemsDir);
  const poems = [];

  for (const entry of entries) {
    const parsed = await parsePoemEntry(entry);
    const expected = expectedPoemFilenameWithExtension(parsed.poem, ".md");
    if (!expected) {
      throw new Error(`Cannot normalize '${entry.relPath}': missing/invalid date or title.`);
    }
    const expectedSubdir = expectedPoemSubdirForDate(parsed.poem.date);
    if (!expectedSubdir) {
      throw new Error(`Cannot normalize '${entry.relPath}': missing/invalid date.`);
    }
    poems.push({
      ...parsed,
      expectedFilename: expected,
      expectedRelPath: path.join(expectedSubdir, expected)
    });
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
  let typographyUpdated = 0;
  for (const item of poems) {
    const expectedPath = path.join(poemsDir, item.expectedRelPath);
    const needsRename = item.currentRelPath !== item.expectedRelPath;
    const needsTypographyUpdate = item.rawContent !== item.normalizedContent;

    if (!needsRename && !needsTypographyUpdate) {
      continue;
    }

    let targetPath = item.fullPath;
    if (needsRename) {
      await mkdir(path.dirname(expectedPath), { recursive: true });
      await rename(item.fullPath, expectedPath);
      targetPath = expectedPath;
      renamed += 1;
    }

    if (needsTypographyUpdate) {
      await writeFile(targetPath, item.normalizedContent, "utf8");
      typographyUpdated += 1;
    }

    if (needsRename && needsTypographyUpdate) {
      console.log(`normalized: ${item.currentRelPath} -> ${item.expectedRelPath} (path + typography)`);
      continue;
    }

    if (needsRename) {
      console.log(`moved: ${item.currentRelPath} -> ${item.expectedRelPath}`);
      continue;
    }

    console.log(`typography: ${item.currentRelPath}`);
  }

  if (renamed > 0) {
    await removeEmptyPoemDirs(poemsDir);
  }

  if (renamed === 0 && typographyUpdated === 0) {
    console.log("No poem path/filename or typography changes needed.");
    return;
  }

  const summary = [];
  if (renamed > 0) {
    summary.push(`renamed ${renamed} poem file(s)`);
  }
  if (typographyUpdated > 0) {
    summary.push(`updated typography in ${typographyUpdated} poem file(s)`);
  }
  console.log(`Completed: ${summary.join("; ")}.`);
}

await normalizePoems();
