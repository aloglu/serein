import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

function publicationDate(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function homepageStatus(html) {
  const main = html.match(/<main\b[^>]*>/i)?.[0] || "";
  const marker = html.match(/<meta\b[^>]*name=["']serein-build-id["'][^>]*>/i)?.[0] || "";
  return {
    buildId: marker.match(/\bcontent=["']([^"']+)["']/i)?.[1] || "",
    renderedDate: main.match(/\bdata-rendered-as-of=["']([^"']+)["']/i)?.[1] || "",
    poemDate: main.match(/\bdata-poem-date=["']([^"']+)["']/i)?.[1] || ""
  };
}

export async function deployAndVerify({
  hookUrl,
  siteUrl = "https://apoemperday.com/",
  fetchImpl = fetch,
  wait = sleep,
  now = () => new Date(),
  log = console.log,
  // Leave time for verification within the workflow's 65-minute limit.
  triggerDelays = [0, 60_000, 120_000, 300_000, 600_000, 900_000],
  verificationAttempts = 40,
  pollIntervalMs = 15_000
}) {
  if (!hookUrl) throw new Error("Missing secret CF_PAGES_DEPLOY_HOOK.");
  const expectedDate = publicationDate(now());
  async function readHomepage() {
    const url = new URL(siteUrl);
    url.searchParams.set("deployment_check", randomUUID());
    const response = await fetchImpl(url, {
      headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`Homepage returned HTTP ${response.status}.`);
    return homepageStatus(await response.text());
  }

  // An old site without a build marker is supported for the first deployment.
  const baseline = await readHomepage();
  let accepted = false;
  for (const [index, delay] of triggerDelays.entries()) {
    if (delay) await wait(delay);
    let status = 0;
    try {
      const response = await fetchImpl(hookUrl, {
        method: "POST", signal: AbortSignal.timeout(30_000)
      });
      status = response.status;
      accepted = response.ok;
    } catch {
      // Do not log fetch errors: their messages may contain the secret hook URL.
    }
    if (accepted) break;
    if (status && status !== 408 && status !== 429 && status < 500) {
      throw new Error(`Deploy hook rejected the request (HTTP ${status}).`);
    }
    log(`Deploy hook attempt ${index + 1} failed (HTTP ${status || "unreachable"}).`);
  }
  if (!accepted) throw new Error("Deploy hook failed after all retry attempts.");
  log(`Deploy accepted; waiting for a new public build with poem date ${expectedDate}.`);

  for (let attempt = 0; attempt < verificationAttempts; attempt++) {
    if (attempt) await wait(pollIntervalMs);
    try {
      const status = await readHomepage();
      if (status.buildId && status.buildId !== baseline.buildId
        && status.renderedDate === expectedDate && status.poemDate === expectedDate) {
        log(`Verified public deployment for ${expectedDate} (build ${status.buildId}).`);
        return status;
      }
      log(`Waiting for publication: rendered ${status.renderedDate || "unknown"}, poem ${status.poemDate || "unknown"}.`);
    } catch {
      log("Homepage unavailable; retrying verification.");
    }
  }
  throw new Error(`Deployment was accepted but a new homepage with the ${expectedDate} poem never appeared.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await deployAndVerify({ hookUrl: process.env.CF_PAGES_DEPLOY_HOOK });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
