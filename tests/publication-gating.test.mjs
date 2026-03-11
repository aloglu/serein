import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const poemsDir = path.join(root, "poems");
const defaultSiteUrl = "https://apoemperday.com";

function runBuild(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/build.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        SITE_URL: defaultSiteUrl,
        ...extraEnv
      },
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

      reject(new Error(`Build failed with exit code ${code}.\n${stdout}${stderr}`));
    });
  });
}

async function readDistFile(...segments) {
  return readFile(path.join(distDir, ...segments), "utf8");
}

async function findDistFile(relativeDir, pattern) {
  const entries = await readdir(path.join(distDir, ...relativeDir.split("/")));
  const match = entries.find((name) => pattern.test(name));
  assert.ok(match, `Expected a file in dist/${relativeDir} matching ${pattern}`);
  return path.join(distDir, ...relativeDir.split("/"), match);
}

after(async () => {
  await runBuild();
});

test("publication gating keeps future poem HTML out of backdated builds", { concurrency: false }, async () => {
  await runBuild({ SEREIN_AS_OF: "2026-02-28" });

  const futurePageHtml = await readDistFile("2026", "03", "01", "index.html");
  assert.match(futurePageHtml, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(futurePageHtml, /<title>Not Available Yet \| A Poem Per Day<\/title>/);
  assert.match(futurePageHtml, /data-poem-blocked="1"/);
  assert.match(futurePageHtml, /assets\/data\/poems\/poem-data-2026-03-01-[a-f0-9]{10}\.json/);
  assert.doesNotMatch(futurePageHtml, /She had blue skin/);
  assert.doesNotMatch(futurePageHtml, /And never knew/);

  const poemDataFiles = await readdir(path.join(distDir, "assets", "data", "poems"));
  assert.deepEqual(poemDataFiles, poemDataFiles.filter((name) => /^poem-data-2026-03-01-[a-f0-9]{10}\.json$/.test(name)));
  assert.equal(poemDataFiles.length, 1);

  const homeDataPath = await findDistFile("assets/data", /^home-data-[a-f0-9]{10}\.json$/);
  const homeData = JSON.parse(await readFile(homeDataPath, "utf8"));
  assert.equal(Array.isArray(homeData.poems), true);
  assert.equal(Array.isArray(homeData.upcoming), true);
  assert.doesNotMatch(JSON.stringify(homeData), /She had blue skin/);
  assert.equal(homeData.upcoming.length, 1);
  assert.equal(homeData.upcoming[0]?.date, "2026-03-01");
  assert.match(homeData.upcoming[0]?.pageDataUrl || "", /^\/assets\/data\/home\/home-poem-data-2026-03-01-[a-f0-9]{10}\.json$/);

  const upcomingHomeData = JSON.parse(await readFile(path.join(distDir, homeData.upcoming[0].pageDataUrl.slice(1)), "utf8"));
  assert.match(upcomingHomeData.poemHtml, /She had blue skin/);
  assert.doesNotMatch(upcomingHomeData.poemHtml, /published-note/);
  assert.doesNotMatch(upcomingHomeData.poemHtml, /Published on March 1, 2026/);

  const sitemapXml = await readDistFile("sitemap.xml");
  assert.doesNotMatch(sitemapXml, /https:\/\/apoemperday\.com\/2026\/03\/01\//);

  const socialFiles = await readdir(path.join(distDir, "social"));
  assert.doesNotMatch(socialFiles.join("\n"), /poem-2026-03-01\.png/);
  assert.doesNotMatch(socialFiles.join("\n"), /poet-shel-silverstein\.png/);

  await runBuild();

  const publishedPageHtml = await readDistFile("2026", "03", "01", "index.html");
  assert.match(publishedPageHtml, /<meta name="robots" content="index, follow">/);
  assert.match(publishedPageHtml, /<title>Masks \| A Poem Per Day<\/title>/);
  assert.match(publishedPageHtml, /She had blue skin/);
  assert.match(publishedPageHtml, /And never knew/);
  assert.match(publishedPageHtml, /data-poem-blocked="0"/);
  assert.doesNotMatch(publishedPageHtml, /assets\/data\/poems\/poem-data-2026-03-01-/);

  await assert.rejects(access(path.join(distDir, "assets", "data", "poems")));
});

test("poets fallback uses canonical author routes even when future-only authors share a slug", { concurrency: false }, async () => {
  // Temporary synthetic poem fixtures created for this test and removed in the finally block.
  const fixtures = [
    {
      relativePath: path.join("2026", "03-March", "2026-03-02-synthetic-route-collision-published-fixture.md"),
      contents: `---
title: Synthetic Route Collision Published Fixture
author: Test Zebra
publication:
date: 2026-03-02
source:
---

Synthetic published route collision fixture.
`
    },
    {
      relativePath: path.join("2026", "03-March", "2026-03-03-synthetic-route-collision-future-fixture.md"),
      contents: `---
title: Synthetic Route Collision Future Fixture
author: Test-Zebra
publication:
date: 2026-03-03
source:
---

Synthetic future route collision fixture.
`
    }
  ];

  try {
    for (const fixture of fixtures) {
      const fullPath = path.join(poemsDir, fixture.relativePath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, fixture.contents, "utf8");
    }

    await runBuild({ SEREIN_AS_OF: "2026-03-02" });

    const poetsIndexHtml = await readDistFile("poets", "index.html");
    assert.match(poetsIndexHtml, /href="\/poets\/test-zebra-2\/">Zebra, Test<\/a>/);
    assert.doesNotMatch(poetsIndexHtml, /href="\/poets\/test-zebra\/">Zebra, Test<\/a>/);

    const publishedPoetPage = await readDistFile("poets", "test-zebra-2", "index.html");
    assert.match(publishedPoetPage, /<title>Test Zebra \| A Poem Per Day<\/title>/);
    assert.match(publishedPoetPage, /content="index, follow"/);

    const futureOnlyPoetPage = await readDistFile("poets", "test-zebra", "index.html");
    assert.match(futureOnlyPoetPage, /<title>Test-Zebra \| A Poem Per Day<\/title>/);
    assert.match(futureOnlyPoetPage, /content="noindex, nofollow"/);
  } finally {
    for (const fixture of fixtures) {
      await rm(path.join(poemsDir, fixture.relativePath), { force: true });
    }
  }
});

test("production data assets only include one day of future metadata", { concurrency: false }, async () => {
  // Temporary synthetic poem fixtures created for this test and removed in the finally block.
  const fixtures = [
    {
      relativePath: path.join("2026", "03-March", "2026-03-02-synthetic-horizon-next-fixture.md"),
      contents: `---
title: Synthetic Horizon Next Fixture
author: Test Horizon
publication:
date: 2026-03-02
source:
---

Synthetic next-day horizon fixture.
`
    },
    {
      relativePath: path.join("2026", "03-March", "2026-03-03-synthetic-horizon-later-fixture.md"),
      contents: `---
title: Synthetic Horizon Later Fixture
author: Test Horizon
publication:
date: 2026-03-03
source:
---

Synthetic two-day horizon fixture.
`
    }
  ];

  try {
    for (const fixture of fixtures) {
      const fullPath = path.join(poemsDir, fixture.relativePath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, fixture.contents, "utf8");
    }

    await runBuild({ SEREIN_AS_OF: "2026-03-01" });

    const archiveDataPath = await findDistFile("assets/data", /^archive-data-[a-f0-9]{10}\.json$/);
    const archiveData = JSON.parse(await readFile(archiveDataPath, "utf8"));
    assert.match(JSON.stringify(archiveData), /Synthetic Horizon Next Fixture/);
    assert.doesNotMatch(JSON.stringify(archiveData), /Synthetic Horizon Later Fixture/);

    const poetsDataPath = await findDistFile("assets/data", /^poets-data-[a-f0-9]{10}\.json$/);
    const poetsData = JSON.parse(await readFile(poetsDataPath, "utf8"));
    assert.match(JSON.stringify(poetsData), /Synthetic Horizon Next Fixture/);
    assert.doesNotMatch(JSON.stringify(poetsData), /Synthetic Horizon Later Fixture/);

    const poetPageHtml = await readDistFile("poets", "test-horizon", "index.html");
    const poetDataMatch = poetPageHtml.match(/data-page-data-url="\.\.\/\.\.\/(assets\/data\/poets\/poet-page-data-test-horizon-[a-f0-9]{10}\.json)"/);
    assert.ok(poetDataMatch, "Expected poet page data asset for Test Horizon");
    const poetPageData = JSON.parse(await readFile(path.join(distDir, poetDataMatch[1]), "utf8"));
    assert.match(JSON.stringify(poetPageData), /Synthetic Horizon Next Fixture/);
    assert.doesNotMatch(JSON.stringify(poetPageData), /Synthetic Horizon Later Fixture/);
  } finally {
    for (const fixture of fixtures) {
      await rm(path.join(poemsDir, fixture.relativePath), { force: true });
    }
  }
});
