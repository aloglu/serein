import process from "node:process";
import { loadPoems } from "./build.mjs";

const warningStatuses = new Set([401, 403, 429]);
const LINK_CHECK_CONCURRENCY = 6;

async function fetchWithTimeout(url, method, headers = undefined) {
  return fetch(url, {
    method,
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(10000)
  });
}

async function checkSourceUrl(url) {
  try {
    let response = await fetchWithTimeout(url, "HEAD").catch(() => null);
    if (!response || response.status === 405 || response.status === 501) {
      response = await fetchWithTimeout(url, "GET", {
        Range: "bytes=0-0"
      });
    }

    if (response.ok) {
      return { level: "ok", status: response.status };
    }
    if (warningStatuses.has(response.status)) {
      return { level: "warn", status: response.status };
    }
    return { level: "error", status: response.status };
  } catch (error) {
    return {
      level: "error",
      status: 0,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function mapWithConcurrency(items, mapper, concurrency = LINK_CHECK_CONCURRENCY) {
  const list = Array.from(items);
  if (list.length === 0) {
    return [];
  }

  const results = new Array(list.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), list.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      if (currentIndex >= list.length) {
        return;
      }
      nextIndex += 1;
      results[currentIndex] = await mapper(list[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

const poems = await loadPoems();
const sourceEntriesByUrl = new Map();

for (const poem of poems) {
  const source = String(poem.source || "").trim();
  if (!source) {
    continue;
  }

  if (!sourceEntriesByUrl.has(source)) {
    sourceEntriesByUrl.set(source, {
      source,
      poems: []
    });
  }

  sourceEntriesByUrl.get(source).poems.push(`${poem.date}: ${poem.title} by ${poem.author}`);
}

const sourceEntries = Array.from(sourceEntriesByUrl.values());

if (sourceEntries.length === 0) {
  process.stdout.write("No source URLs found.\n");
  process.exit(0);
}

let warningCount = 0;
let errorCount = 0;

const results = await mapWithConcurrency(sourceEntries, async (entry) => ({
  entry,
  result: await checkSourceUrl(entry.source)
}));

for (const { entry, result } of results) {
  const label = result.level === "ok" ? "OK" : result.level === "warn" ? "WARN" : "ERROR";
  const detail = result.message ? ` (${result.message})` : "";
  process.stdout.write(`[${label}] ${entry.source} -> ${result.status || "no response"}${detail}\n`);
  for (const poemLabel of entry.poems) {
    process.stdout.write(`  - ${poemLabel}\n`);
  }

  if (result.level === "warn") {
    warningCount += 1;
  }
  if (result.level === "error") {
    errorCount += 1;
  }
}

process.stdout.write(`\nSummary: ${sourceEntries.length} URL(s), ${warningCount} warning(s), ${errorCount} error(s).\n`);

if (errorCount > 0) {
  process.exitCode = 1;
}
