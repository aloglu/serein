import process from "node:process";
import { loadPoems } from "./build.mjs";

const warningStatuses = new Set([401, 403, 429]);

async function fetchWithTimeout(url, method) {
  return fetch(url, {
    method,
    redirect: "follow",
    signal: AbortSignal.timeout(10000)
  });
}

async function checkSourceUrl(url) {
  try {
    let response = await fetchWithTimeout(url, "HEAD").catch(() => null);
    if (!response || response.status === 405 || response.status === 501) {
      response = await fetchWithTimeout(url, "GET");
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

const poems = await loadPoems();
const sourceEntries = [];
const seenSources = new Set();

for (const poem of poems) {
  const source = String(poem.source || "").trim();
  if (!source || seenSources.has(source)) {
    continue;
  }
  seenSources.add(source);
  sourceEntries.push({
    source,
    poems: poems
      .filter((candidate) => String(candidate.source || "").trim() === source)
      .map((candidate) => `${candidate.date}: ${candidate.title} by ${candidate.author}`)
  });
}

if (sourceEntries.length === 0) {
  process.stdout.write("No source URLs found.\n");
  process.exit(0);
}

let warningCount = 0;
let errorCount = 0;

for (const entry of sourceEntries) {
  const result = await checkSourceUrl(entry.source);
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
