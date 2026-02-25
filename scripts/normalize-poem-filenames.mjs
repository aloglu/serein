import { readdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { expectedPoemFilenameWithExtension } from "./poem-filenames.mjs";

const root = process.cwd();
const poemsDir = path.join(root, "data", "poems");

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

async function parsePoemEntry(entry) {
  const fullPath = path.join(poemsDir, entry.name);
  const raw = await readFile(fullPath, "utf8");
  return { poem: parsePoemMarkdownFile(raw, entry.name), current: entry.name, fullPath };
}

async function normalizePoemFilenames() {
  const entries = await readdir(poemsDir, { withFileTypes: true });
  const poems = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const parsed = await parsePoemEntry(entry);
    const expected = expectedPoemFilenameWithExtension(parsed.poem, ".md");
    if (!expected) {
      throw new Error(`Cannot normalize '${entry.name}': missing/invalid date or title.`);
    }
    poems.push({ ...parsed, expected });
  }

  const expectedNames = new Map();
  for (const item of poems) {
    if (expectedNames.has(item.expected) && expectedNames.get(item.expected) !== item.current) {
      throw new Error(
        `Filename collision: '${item.current}' and '${expectedNames.get(item.expected)}' both map to '${item.expected}'.`
      );
    }
    expectedNames.set(item.expected, item.current);
  }

  let changed = 0;
  for (const item of poems) {
    const expectedPath = path.join(poemsDir, item.expected);
    const needsRename = item.current !== item.expected;

    if (!needsRename) {
      continue;
    }

    await rename(item.fullPath, expectedPath);
    changed += 1;
    console.log(`renamed: ${item.current} -> ${item.expected}`);
  }

  if (changed === 0) {
    console.log("No filename changes needed.");
  } else {
    console.log(`Updated ${changed} poem file(s).`);
  }
}

await normalizePoemFilenames();
