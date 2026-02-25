import { readdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { expectedPoemFilename } from "./poem-filenames.mjs";

const root = process.cwd();
const poemsDir = path.join(root, "data", "poems");

async function normalizePoemFilenames() {
  const entries = await readdir(poemsDir, { withFileTypes: true });
  const poems = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const fullPath = path.join(poemsDir, entry.name);
    const parsed = JSON.parse(await readFile(fullPath, "utf8"));
    const expected = expectedPoemFilename(parsed);
    if (!expected) {
      throw new Error(`Cannot normalize '${entry.name}': missing/invalid date or title.`);
    }
    poems.push({ current: entry.name, expected });
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

  let renamed = 0;
  for (const item of poems) {
    if (item.current === item.expected) {
      continue;
    }
    await rename(path.join(poemsDir, item.current), path.join(poemsDir, item.expected));
    renamed += 1;
    console.log(`renamed: ${item.current} -> ${item.expected}`);
  }

  if (renamed === 0) {
    console.log("No filename changes needed.");
  } else {
    console.log(`Renamed ${renamed} poem file(s).`);
  }
}

await normalizePoemFilenames();
