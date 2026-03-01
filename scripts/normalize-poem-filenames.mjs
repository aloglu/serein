import { mkdir, readdir, readFile, rename, rmdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { expectedPoemFilenameWithExtension } from "./poem-filenames.mjs";

const root = process.cwd();
const poemsDir = path.join(root, "poems");

function normalizeNewlines(input) {
  return String(input || "").replace(/\r\n/g, "\n");
}

function stripWrappingQuotes(input) {
  const raw = String(input || "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
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
  return { poem: parsePoemMarkdownFile(raw, file.relPath), currentRelPath: file.relPath, fullPath: file.fullPath };
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

async function normalizePoemFilenames() {
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

  let changed = 0;
  for (const item of poems) {
    const expectedPath = path.join(poemsDir, item.expectedRelPath);
    const needsRename = item.currentRelPath !== item.expectedRelPath;

    if (!needsRename) {
      continue;
    }

    await mkdir(path.dirname(expectedPath), { recursive: true });
    await rename(item.fullPath, expectedPath);
    changed += 1;
    console.log(`moved: ${item.currentRelPath} -> ${item.expectedRelPath}`);
  }

  if (changed > 0) {
    await removeEmptyPoemDirs(poemsDir);
  }

  if (changed === 0) {
    console.log("No poem path/filename changes needed.");
  } else {
    console.log(`Updated ${changed} poem file(s).`);
  }
}

await normalizePoemFilenames();
