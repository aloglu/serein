import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { poemSourceHash, speakablePoemText, stableHash } from "../scripts/tts-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const poemsDir = path.join(root, "poems");
const ttsDir = path.join(root, "assets", "tts");
const ttsManifestFile = path.join(ttsDir, "manifest.json");
const defaultSiteUrl = "https://apoemperday.com";
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

function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function addDaysToYyyyMmDd(yyyyMmDd, days) {
  const match = String(yyyyMmDd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  assert.ok(match, `Expected a YYYY-MM-DD date, received '${yyyyMmDd}'`);
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function listPoemDates(dirPath = poemsDir) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const dates = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      dates.push(...await listPoemDates(fullPath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const match = entry.name.match(/^(\d{4}-\d{2}-\d{2})-/);
    if (match) {
      dates.push(match[1]);
    }
  }

  return dates;
}

async function nextUnusedPoemDates(count) {
  const poemDates = await listPoemDates();
  assert.ok(poemDates.length > 0, "Expected at least one poem date in the poems directory");
  const latestDate = poemDates.reduce((latest, current) => (current > latest ? current : latest));
  return Array.from({ length: count }, (_, index) => addDaysToYyyyMmDd(latestDate, index + 1));
}

function poemRelativePath(yyyyMmDd, slug) {
  const match = String(yyyyMmDd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  assert.ok(match, `Expected a YYYY-MM-DD date, received '${yyyyMmDd}'`);
  const monthDir = MONTH_DIR_NAMES[match[2]];
  assert.ok(monthDir, `Unsupported month '${match[2]}'`);
  return path.join(match[1], monthDir, `${yyyyMmDd}-${slug}.md`);
}

async function readDirNamesIfExists(targetPath) {
  try {
    return await readdir(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

after(async () => {
  await runBuild();
});

test("publication gating keeps future poem HTML out of backdated builds", { concurrency: false }, async () => {
  const [targetDate] = await nextUnusedPoemDates(1);
  const blockedAsOf = addDaysToYyyyMmDd(targetDate, -1);
  const fixture = {
    relativePath: poemRelativePath(targetDate, "synthetic-publication-gating-fixture"),
    contents: `---
title: Synthetic Publication Gating Fixture
author: Test Gate
publication:
date: ${targetDate}
source:
---

Line one of the synthetic gating fixture.
Line two of the synthetic gating fixture.
`
  };

  try {
    const fullPath = path.join(poemsDir, fixture.relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, fixture.contents, "utf8");

    await runBuild({ SEREIN_AS_OF: blockedAsOf });

    const futurePageHtml = await readDistFile(...targetDate.split("-").flatMap((part, index) => (
      index === 0 ? [part] : index === 1 ? [part] : [part, "index.html"]
    )));
    assert.match(futurePageHtml, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(futurePageHtml, /<title>Not Available Yet \| A Poem Per Day<\/title>/);
    assert.match(futurePageHtml, /data-poem-blocked="1"/);
    assert.match(futurePageHtml, new RegExp(`assets/data/poems/poem-data-${targetDate}-[a-f0-9]{10}\\.json`));
    assert.doesNotMatch(futurePageHtml, /Line one of the synthetic gating fixture/);
    assert.doesNotMatch(futurePageHtml, /Line two of the synthetic gating fixture/);

    const poemDataFiles = await readdir(path.join(distDir, "assets", "data", "poems"));
    const targetPoemDataFiles = poemDataFiles.filter((name) => new RegExp(`^poem-data-${targetDate}-[a-f0-9]{10}\\.json$`).test(name));
    assert.equal(targetPoemDataFiles.length, 1);

    const homeDataPath = await findDistFile("assets/data", /^home-data-[a-f0-9]{10}\.json$/);
    const homeData = JSON.parse(await readFile(homeDataPath, "utf8"));
    assert.equal(Array.isArray(homeData.poems), true);
    assert.equal(Array.isArray(homeData.upcoming), true);
    assert.doesNotMatch(JSON.stringify(homeData), /Line one of the synthetic gating fixture/);
    assert.equal(homeData.poems.length <= 2, true);
    assert.equal(Object.hasOwn(homeData.poems[0] || {}, "poemHtml"), true);
    assert.equal(Object.hasOwn(homeData.poems[0] || {}, "authorMetaHtml"), true);
    assert.equal(Object.hasOwn(homeData.poems[0] || {}, "pageDataUrl"), false);

    const sitemapXml = await readDistFile("sitemap.xml");
    const targetRoute = targetDate.replaceAll("-", "/");
    assert.doesNotMatch(sitemapXml, new RegExp(`https://apoemperday\\.com/${targetRoute}/`));

    const socialFiles = await readdir(path.join(distDir, "social"));
    assert.doesNotMatch(socialFiles.join("\n"), new RegExp(`poem-${targetDate}\\.png`));

    await runBuild({ SEREIN_AS_OF: targetDate });

    const publishedPageHtml = await readDistFile(...targetDate.split("-").flatMap((part, index) => (
      index === 0 ? [part] : index === 1 ? [part] : [part, "index.html"]
    )));
    assert.match(publishedPageHtml, /<meta name="robots" content="index, follow">/);
    assert.match(publishedPageHtml, /<title>Synthetic Publication Gating Fixture \| A Poem Per Day<\/title>/);
    assert.match(publishedPageHtml, /Line one of the synthetic gating fixture/);
    assert.match(publishedPageHtml, /Line two of the synthetic gating fixture/);
    assert.match(publishedPageHtml, /data-poem-blocked="0"/);
    assert.doesNotMatch(publishedPageHtml, new RegExp(`assets/data/poems/poem-data-${targetDate}-`));

    const normalBuildPoemDataFiles = await readDirNamesIfExists(path.join(distDir, "assets", "data", "poems"));
    assert.doesNotMatch(normalBuildPoemDataFiles.join("\n"), new RegExp(`poem-data-${targetDate}-[a-f0-9]{10}\\.json`));
  } finally {
    await rm(path.join(poemsDir, fixture.relativePath), { force: true });
  }
});

test("home and poem pages render date, byline prefixes, and publication footer separately", { concurrency: false }, async () => {
  const [targetDate] = await nextUnusedPoemDates(1);
  const expectedDateLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${targetDate}T00:00:00Z`));
  const fixture = {
    relativePath: poemRelativePath(targetDate, "synthetic-layout-meta-fixture"),
    contents: `---
title: Synthetic Layout Meta Fixture
author: Test Layout Fixture Poet
translator: Test Layout Fixture Translator
publication: Synthetic Review
date: ${targetDate}
source: https://example.com/layout-source
---

Synthetic layout fixture line one.
Synthetic layout fixture line two.
`
  };

  try {
    const fullPath = path.join(poemsDir, fixture.relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, fixture.contents, "utf8");

    await runBuild({ SEREIN_AS_OF: targetDate });

    const poemPageHtml = await readDistFile(...targetDate.split("-").flatMap((part, index) => (
      index === 0 ? [part] : index === 1 ? [part] : [part, "index.html"]
    )));
    assert.match(poemPageHtml, new RegExp(`<p class="meta poem-date"><time datetime="${targetDate}">${expectedDateLabel}<\\/time><\\/p>`));
    assert.match(poemPageHtml, /<span class="poem-meta-label poem-meta-label-author">By<\/span><span class="poem-meta-value poem-meta-value-author"><a href="\/poets\/test-layout-fixture-poet\/">Test Layout Fixture Poet<\/a><\/span><span aria-hidden="true" class="separator-mark poem-meta-separator">&#8729;<\/span><span class="poem-meta-label poem-meta-label-translator">Tr\.<\/span><span class="poem-meta-value poem-meta-value-translator">Test Layout Fixture Translator<\/span>/);
    assert.doesNotMatch(poemPageHtml, /translated by/);
    assert.doesNotMatch(poemPageHtml, /Published on/);
    assert.match(poemPageHtml, /<p class="publication-note"><span class="publication-label">Source: <\/span>Synthetic Review<span aria-hidden="true" class="separator-mark meta-separator">&middot;<\/span><a href="https:\/\/example\.com\/layout-source" target="_blank" rel="noreferrer">Link<\/a><\/p>/);

    const homeHtml = await readDistFile("index.html");
    assert.match(homeHtml, new RegExp(`<p id="home-date" class="meta poem-date"><time datetime="${targetDate}">${expectedDateLabel}<\\/time><\\/p>`));
    assert.match(homeHtml, /<span class="poem-meta-label poem-meta-label-author">By<\/span><span class="poem-meta-value poem-meta-value-author"><a href="\/poets\/test-layout-fixture-poet\/">Test Layout Fixture Poet<\/a><\/span><span aria-hidden="true" class="separator-mark poem-meta-separator">&#8729;<\/span><span class="poem-meta-label poem-meta-label-translator">Tr\.<\/span><span class="poem-meta-value poem-meta-value-translator">Test Layout Fixture Translator<\/span>/);
    assert.match(homeHtml, /<p class="publication-note"><span class="publication-label">Source: <\/span>Synthetic Review<span aria-hidden="true" class="separator-mark meta-separator">&middot;<\/span><a href="https:\/\/example\.com\/layout-source" target="_blank" rel="noreferrer">Link<\/a><\/p>/);
  } finally {
    await rm(path.join(poemsDir, fixture.relativePath), { force: true });
  }
});

test("rss falls back cleanly for poems that use custom markup", { concurrency: false }, async () => {
  const [targetDate] = await nextUnusedPoemDates(1);
  const fixture = {
    relativePath: poemRelativePath(targetDate, "rss-custom-markup-fixture"),
    contents: `---
title: RSS Custom Markup Fixture
author: Test RSS Poet
date: ${targetDate}
---

::line |<left phrase| |~4ch| |>right phrase|
`
  };

  try {
    const fullPath = path.join(poemsDir, fixture.relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, fixture.contents, "utf8");

    await runBuild({ SEREIN_AS_OF: targetDate });

    const rssXml = await readDistFile("rss.xml");
    const poemLink = `${defaultSiteUrl}/${targetDate.replaceAll("-", "/")}/`;
    const itemMatch = rssXml.match(new RegExp(
      `<item>[\\s\\S]*?<title>RSS Custom Markup Fixture<\\/title>[\\s\\S]*?<link>${escapeRegex(poemLink)}<\\/link>[\\s\\S]*?<description><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/description>[\\s\\S]*?<content:encoded><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/content:encoded>[\\s\\S]*?<\\/item>`
    ));

    assert.ok(itemMatch, "Expected RSS item for the custom-markup fixture");
    assert.equal(
      itemMatch[1],
      "RSS Custom Markup Fixture by Test RSS Poet. This poem uses special formatting. Visit the website to read it."
    );
    assert.equal(
      itemMatch[2],
      `<p>This poem uses special formatting that is not suited for RSS feeds. Please <a href="${poemLink}">visit the website to read it</a>.</p>`
    );
    assert.doesNotMatch(itemMatch[1], /::line/);
  } finally {
    await rm(path.join(poemsDir, fixture.relativePath), { force: true });
  }
});

test("poets fallback uses canonical author routes even when future-only authors share a slug", { concurrency: false }, async () => {
  const [publishedDate, , futureDate] = await nextUnusedPoemDates(3);
  // Temporary synthetic poem fixtures created for this test and removed in the finally block.
  const fixtures = [
    {
      relativePath: poemRelativePath(publishedDate, "synthetic-route-collision-published-fixture"),
      contents: `---
title: Synthetic Route Collision Published Fixture
author: Test Zebra
publication:
date: ${publishedDate}
source:
---

Synthetic published route collision fixture.
`
    },
    {
      relativePath: poemRelativePath(futureDate, "synthetic-route-collision-future-fixture"),
      contents: `---
title: Synthetic Route Collision Future Fixture
author: Test-Zebra
publication:
date: ${futureDate}
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

    await runBuild({ SEREIN_AS_OF: publishedDate });

    const poetsIndexHtml = await readDistFile("poets", "index.html");
    assert.match(poetsIndexHtml, /href="\/poets\/test-zebra-2\/">Zebra, Test<\/a>/);
    assert.doesNotMatch(poetsIndexHtml, /href="\/poets\/test-zebra\/">Zebra, Test<\/a>/);

    const publishedPoetPage = await readDistFile("poets", "test-zebra-2", "index.html");
    assert.match(publishedPoetPage, /<title>Test Zebra \| A Poem Per Day<\/title>/);
    assert.match(publishedPoetPage, /content="index, follow"/);
    assert.match(publishedPoetPage, /<h1 id="poet-page-author">Test Zebra<\/h1>\s*<div class="content-block poet-page-content">/);
    assert.doesNotMatch(publishedPoetPage, /poet-page-meta/);
    assert.doesNotMatch(publishedPoetPage, /Test Zebra has one published poem on A Poem Per Day\./);

    const futureOnlyPoetPage = await readDistFile("poets", "test-zebra", "index.html");
    assert.match(futureOnlyPoetPage, /<title>Test-Zebra \| A Poem Per Day<\/title>/);
    assert.match(futureOnlyPoetPage, /content="noindex, nofollow"/);
    assert.match(futureOnlyPoetPage, /data-page-data-url=""/);

    const poetDataFiles = await readDirNamesIfExists(path.join(distDir, "assets", "data", "poets"));
    assert.doesNotMatch(poetDataFiles.join("\n"), /^poet-page-data-test-zebra-[a-f0-9]{10}\.json$/m);
  } finally {
    for (const fixture of fixtures) {
      await rm(path.join(poemsDir, fixture.relativePath), { force: true });
    }
  }
});

test("production data assets only include one day of future metadata", { concurrency: false }, async () => {
  const [nextDate, laterDate] = await nextUnusedPoemDates(2);
  // Temporary synthetic poem fixtures created for this test and removed in the finally block.
  const fixtures = [
    {
      relativePath: poemRelativePath(nextDate, "synthetic-horizon-next-fixture"),
      contents: `---
title: Synthetic Horizon Next Fixture
author: Test Horizon
publication:
date: ${nextDate}
source:
---

Synthetic next-day horizon fixture.
`
    },
    {
      relativePath: poemRelativePath(laterDate, "synthetic-horizon-later-fixture"),
      contents: `---
title: Synthetic Horizon Later Fixture
author: Test Horizon
publication:
date: ${laterDate}
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

    await runBuild({ SEREIN_AS_OF: addDaysToYyyyMmDd(nextDate, -1) });

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

test("speakable poem text collapses custom aligned markup into plain speech text", () => {
  const speech = speakablePoemText(`First line.

::line |<left phrase| |~4ch| |>right phrase|

Last line.`);

  assert.equal(speech, `First line.\n\nleft phrase right phrase\n\nLast line.`);
});

test("published poem pages render a listen control when a managed TTS asset exists", { concurrency: false }, async () => {
  const [targetDate] = await nextUnusedPoemDates(1);
  const slug = "synthetic-tts-player-fixture";
  const fixture = {
    relativePath: poemRelativePath(targetDate, slug),
    contents: `---
title: Synthetic TTS Player Fixture
author: Test Audio Poet
publication:
date: ${targetDate}
source:
---

Synthetic audio fixture line one.
Synthetic audio fixture line two.
`
  };
  const manifestBackup = await readFile(ttsManifestFile, "utf8").catch(() => "");
  const poemBody = `Synthetic audio fixture line one.\nSynthetic audio fixture line two.\n`;
  const sourceHash = poemSourceHash(poemBody);
  const assetKey = stableHash(JSON.stringify({
    date: targetDate,
    sourceHash,
    renderProfile: "house-default-v1",
    provider: "openai",
    modelId: "gpt-4o-mini-tts",
    voice: "sage",
    outputFormat: "mp3",
    instructions: "Read this poem aloud with calm, attentive pacing. Respect line breaks as natural pauses and keep the delivery intimate rather than theatrical.",
    speed: 0.96
  }));
  const audioUrl = `/assets/tts/audio/${targetDate.slice(0, 4)}/${targetDate.slice(5, 7)}/${targetDate}-${slug}.${assetKey}.mp3`;
  const audioPath = path.join(root, ...audioUrl.slice(1).split("/"));

  try {
    const fullPath = path.join(poemsDir, fixture.relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, fixture.contents, "utf8");

    await mkdir(path.dirname(audioPath), { recursive: true });
    await writeFile(audioPath, "synthetic audio bytes", "utf8");
    await writeFile(ttsManifestFile, `${JSON.stringify({
      version: 1,
      poems: {
        [targetDate]: {
          audioUrl,
          sourceHash,
          assetKey,
          renderProfile: "house-default-v1",
          provider: "openai",
          modelId: "gpt-4o-mini-tts",
          voice: "sage",
          outputFormat: "mp3",
          mimeType: "audio/mpeg",
          instructions: "Read this poem aloud with calm, attentive pacing. Respect line breaks as natural pauses and keep the delivery intimate rather than theatrical.",
          speed: 0.96,
          generatedAt: "2026-03-14T00:00:00.000Z"
        }
      }
    }, null, 2)}\n`, "utf8");

    await runBuild({ SEREIN_AS_OF: targetDate });

    const poemPageHtml = await readDistFile(...targetDate.split("-").flatMap((part, index) => (
      index === 0 ? [part] : index === 1 ? [part] : [part, "index.html"]
    )));
    assert.match(poemPageHtml, /data-tts-root/);
    assert.match(poemPageHtml, /data-tts-toggle/);
    assert.match(poemPageHtml, new RegExp(escapeRegex(audioUrl)));
    assert.match(poemPageHtml, /Listen/);

    const copiedAudio = path.join(distDir, ...audioUrl.slice(1).split("/"));
    const copiedAudioContents = await readFile(copiedAudio, "utf8");
    assert.equal(copiedAudioContents, "synthetic audio bytes");
  } finally {
    await rm(path.join(poemsDir, fixture.relativePath), { force: true });
    await rm(audioPath, { force: true });
    await writeFile(ttsManifestFile, manifestBackup, "utf8");
  }
});

test("page bundles include guarded link prefetching for likely next navigations", { concurrency: false }, async () => {
  await runBuild();

  const homeHtml = await readDistFile("index.html");
  assert.match(homeHtml, /data-prefetch="eager">Archive<\/a>/);
  assert.match(homeHtml, /data-prefetch="eager">About<\/a>/);

  const bundlePatterns = [
    /^home-[A-Z0-9]+\.js$/,
    /^archive-[A-Z0-9]+\.js$/,
    /^poets-[A-Z0-9]+\.js$/,
    /^poetPage-[A-Z0-9]+\.js$/,
    /^about-[A-Z0-9]+\.js$/,
    /^poem-[A-Z0-9]+\.js$/
  ];

  for (const pattern of bundlePatterns) {
    const bundlePath = await findDistFile("assets", pattern);
    const contents = await readFile(bundlePath, "utf8");
    assert.match(contents, /prefetch/);
    assert.match(contents, /pointerenter/);
    assert.match(contents, /touchstart/);
    assert.match(contents, /saveData/);
    assert.match(contents, /requestIdleCallback/);
    assert.match(contents, /data-prefetch="eager"|data-prefetch=\\"eager\\"/);
  }
});
