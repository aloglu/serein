import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const normalizeScriptSource = path.join(root, "scripts", "normalize-poems.mjs");
const filenameScriptSource = path.join(root, "scripts", "poem-filenames.mjs");
const MONTH_DIR_NAMES = {
  "01": "01-January",
  "02": "02-February",
  "03": "03-March",
  "04": "04-April",
  "05": "05-May",
  "06": "06-June",
  "07": "07-July",
  "08": "08-August",
  "09": "09-September",
  "10": "10-October",
  "11": "11-November",
  "12": "12-December"
};

function runNormalize(workdir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/normalize-poems.mjs"], {
      cwd: workdir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`Normalize failed with exit code ${code}.\n${stdout}${stderr}`));
    });
  });
}

function currentPublicationDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysToYyyyMmDd(yyyyMmDd, days) {
  const match = String(yyyyMmDd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  assert.ok(match, `Expected a YYYY-MM-DD date, received '${yyyyMmDd}'`);
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function poemRelativePath(yyyyMmDd, slug) {
  const match = String(yyyyMmDd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  assert.ok(match, `Expected a YYYY-MM-DD date, received '${yyyyMmDd}'`);
  const monthDir = MONTH_DIR_NAMES[match[2]];
  assert.ok(monthDir, `Unsupported month '${match[2]}'`);
  return path.join(match[1], monthDir, `${yyyyMmDd}-${slug}.md`);
}

function buildPoemMarkdown({ title, author = "Test Normalize", date, body }) {
  return `---
title: ${title}
author: ${author}
translator:
date: ${date}
publication:
source:
---

${body}
`;
}

async function writeWorkspacePoem(workspace, relativePath, contents) {
  const fullPath = path.join(workspace, "poems", relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents, "utf8");
  return fullPath;
}

async function createNormalizeWorkspace({ baselinePoems = [], fixturePoems = [] }) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "serein-normalize-"));
  await mkdir(path.join(workspace, "scripts"), { recursive: true });
  await mkdir(path.join(workspace, "poems"), { recursive: true });
  await copyFile(normalizeScriptSource, path.join(workspace, "scripts", "normalize-poems.mjs"));
  await copyFile(filenameScriptSource, path.join(workspace, "scripts", "poem-filenames.mjs"));

  for (const poem of baselinePoems) {
    await writeWorkspacePoem(
      workspace,
      poemRelativePath(poem.date, poem.slug),
      buildPoemMarkdown({
        title: poem.title,
        author: poem.author,
        date: poem.date,
        body: poem.body || "Baseline line."
      })
    );
  }

  for (const poem of fixturePoems) {
    await writeWorkspacePoem(workspace, poem.relativePath, poem.contents);
  }

  return workspace;
}

async function findPoemFilesBySlug(workspace, slug, dirPath = path.join(workspace, "poems")) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const matches = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findPoemFilesBySlug(workspace, slug, fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(`-${slug}.md`)) {
      matches.push(fullPath);
    }
  }

  return matches;
}

function parseDateFrontmatter(contents) {
  const match = String(contents).match(/^date:\s*(.+)$/m);
  assert.ok(match, "Expected date frontmatter line");
  return match[1].trim();
}

test("normalize resolves multiple `next` dates from the closest open date, not the furthest scheduled date", { concurrency: false }, async () => {
  const today = currentPublicationDate();
  const tomorrow = addDaysToYyyyMmDd(today, 1);
  const dayAfterTomorrow = addDaysToYyyyMmDd(today, 2);
  const thirdOpenDay = addDaysToYyyyMmDd(today, 3);
  const farFutureDate = `${String(Number(today.slice(0, 4)) + 1)}-04-24`;
  const slugAlpha = "synthetic-next-queue-alpha-fixture";
  const slugBeta = "synthetic-next-queue-beta-fixture";
  const workspace = await createNormalizeWorkspace({
    baselinePoems: [
      {
        date: today,
        slug: "occupied-today-fixture",
        title: "Occupied Today Fixture"
      },
      {
        date: dayAfterTomorrow,
        slug: "occupied-day-after-tomorrow-fixture",
        title: "Occupied Day After Tomorrow Fixture"
      },
      {
        date: farFutureDate,
        slug: "far-future-fixture",
        title: "Far Future Fixture"
      }
    ],
    fixturePoems: [
      {
        relativePath: path.join("__normalize-fixtures__", "a-alpha.md"),
        contents: buildPoemMarkdown({
          title: "Synthetic Next Queue Alpha Fixture",
          date: "next",
          body: "Alpha line."
        })
      },
      {
        relativePath: path.join("__normalize-fixtures__", "b-beta.md"),
        contents: buildPoemMarkdown({
          title: "Synthetic Next Queue Beta Fixture",
          date: "next",
          body: "Beta line."
        })
      }
    ]
  });

  try {
    await runNormalize(workspace);

    const expectedAlphaPath = path.join(workspace, "poems", poemRelativePath(tomorrow, slugAlpha));
    const expectedBetaPath = path.join(workspace, "poems", poemRelativePath(thirdOpenDay, slugBeta));
    const [alphaContents, betaContents] = await Promise.all([
      readFile(expectedAlphaPath, "utf8"),
      readFile(expectedBetaPath, "utf8")
    ]);

    assert.equal(parseDateFrontmatter(alphaContents), tomorrow);
    assert.equal(parseDateFrontmatter(betaContents), thirdOpenDay);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("normalize resolves `random-may` into unique unused dates in the current publication year", { concurrency: false }, async () => {
  const publicationYear = currentPublicationDate().slice(0, 4);
  const occupiedDate = `${publicationYear}-05-01`;
  const slugAlpha = "synthetic-random-month-alpha-fixture";
  const slugBeta = "synthetic-random-month-beta-fixture";
  const workspace = await createNormalizeWorkspace({
    baselinePoems: [
      {
        date: occupiedDate,
        slug: "occupied-may-day-fixture",
        title: "Occupied May Day Fixture"
      }
    ],
    fixturePoems: [
      {
        relativePath: path.join("__normalize-fixtures__", "random-alpha.md"),
        contents: buildPoemMarkdown({
          title: "Synthetic Random Month Alpha Fixture",
          date: "random-may",
          body: "Random alpha line."
        })
      },
      {
        relativePath: path.join("__normalize-fixtures__", "random-beta.md"),
        contents: buildPoemMarkdown({
          title: "Synthetic Random Month Beta Fixture",
          date: "random-may",
          body: "Random beta line."
        })
      }
    ]
  });

  try {
    await runNormalize(workspace);

    const alphaMatches = await findPoemFilesBySlug(workspace, slugAlpha);
    const betaMatches = await findPoemFilesBySlug(workspace, slugBeta);
    assert.equal(alphaMatches.length, 1);
    assert.equal(betaMatches.length, 1);

    const [alphaContents, betaContents] = await Promise.all([
      readFile(alphaMatches[0], "utf8"),
      readFile(betaMatches[0], "utf8")
    ]);
    const alphaDate = parseDateFrontmatter(alphaContents);
    const betaDate = parseDateFrontmatter(betaContents);

    assert.match(alphaDate, new RegExp(`^${publicationYear}-05-\\d{2}$`));
    assert.match(betaDate, new RegExp(`^${publicationYear}-05-\\d{2}$`));
    assert.notEqual(alphaDate, betaDate);
    assert.notEqual(alphaDate, occupiedDate);
    assert.notEqual(betaDate, occupiedDate);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("normalize removes empty frontmatter fields and writes canonical frontmatter order", { concurrency: false }, async () => {
  const today = currentPublicationDate();
  const tomorrow = addDaysToYyyyMmDd(today, 1);
  const slug = "frontmatter-order-fixture-test";
  const workspace = await createNormalizeWorkspace({
    baselinePoems: [
      {
        date: today,
        slug: "occupied-today-frontmatter-fixture",
        title: "Occupied Today Frontmatter Fixture"
      }
    ],
    fixturePoems: [
      {
        relativePath: path.join("__normalize-fixtures__", "frontmatter-order.md"),
        contents: `---
source:
date: next
publication: "Collected Poems: Volume 1"
translator:
author: Test Normalize
title: "Frontmatter Order Fixture: Test"
---

Body line.
`
      }
    ]
  });

  try {
    await runNormalize(workspace);

    const expectedPath = path.join(workspace, "poems", poemRelativePath(tomorrow, slug));
    const contents = await readFile(expectedPath, "utf8");

    assert.equal(contents, `---
title: "Frontmatter Order Fixture: Test"
author: Test Normalize
publication: "Collected Poems: Volume 1"
date: ${tomorrow}
tts: yes
---

Body line.
`);
    assert.doesNotMatch(contents, /^translator:/m);
    assert.doesNotMatch(contents, /^source:/m);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("normalize preserves legacy tty: no as tts: no and keeps tts as the last frontmatter field", { concurrency: false }, async () => {
  const today = currentPublicationDate();
  const slug = "tty-disabled-fixture";
  const workspace = await createNormalizeWorkspace({
    fixturePoems: [
      {
        relativePath: path.join("__normalize-fixtures__", "tty-disabled.md"),
        contents: `---
tty: no
date: ${today}
author: Test Normalize
title: TTY Disabled Fixture
---

Body line.
`
      }
    ]
  });

  try {
    await runNormalize(workspace);

    const expectedPath = path.join(workspace, "poems", poemRelativePath(today, slug));
    const contents = await readFile(expectedPath, "utf8");

    assert.equal(contents, `---
title: TTY Disabled Fixture
author: Test Normalize
date: ${today}
tts: no
---

Body line.
`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("normalize repairs common mojibake punctuation in poem text", { concurrency: false }, async () => {
  const date = "2026-03-11";
  const slug = "synthetic-mojibake-fixture";
  const workspace = await createNormalizeWorkspace({
    fixturePoems: [
      {
        relativePath: path.join("__normalize-fixtures__", "mojibake.md"),
        contents: buildPoemMarkdown({
          title: "Synthetic Mojibake Fixture",
          date,
          body: "The hangmanâ€™s horse laughedâ€¦ Then winter returnedâ€”slowly."
        })
      }
    ]
  });

  try {
    await runNormalize(workspace);
    const expectedPath = path.join(workspace, "poems", poemRelativePath(date, slug));
    const contents = await readFile(expectedPath, "utf8");
    assert.match(contents, /hangman’s horse laughed… Then winter returned—slowly\./);
    assert.doesNotMatch(contents, /â€™|â€¦|â€”/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
