import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

function readArgValue(flagName) {
  const exactIndex = process.argv.indexOf(flagName);
  if (exactIndex >= 0) {
    return process.argv[exactIndex + 1] || "";
  }
  return "";
}

function parseDateArg() {
  const raw = String(readArgValue("--date") || readArgValue("--as-of") || "").trim();
  if (!raw) {
    throw new Error("Missing --date YYYY-MM-DD.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid date '${raw}'. Expected YYYY-MM-DD.`);
  }
  return raw;
}

function sanitizedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key || key.includes("\u0000") || key.includes("=") || /^\s/.test(key) || /\s/.test(key)) {
      continue;
    }
    if (key.startsWith("-") || key.startsWith("=")) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

function runSyncStep({ nodeBin, env, date, force }) {
  const args = ["scripts/tts-sync.mjs", "--date", date];
  if (force) {
    args.push("--force");
  }

  const result = spawnSync(nodeBin, args, {
    stdio: "inherit",
    env
  });

  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1);
  }
  if (result.signal) {
    process.exit(1);
  }
}

function runPreviewStep({ nodeBin, env, date }) {
  const route = `/${date.replaceAll("-", "/")}/`;
  console.log(`Preview the poem page at ${route} once the local server is ready.`);

  const child = spawn(nodeBin, ["scripts/preview.mjs", "--watch", "--date", date], {
    stdio: "inherit",
    env
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 0);
  });
}

function main() {
  const date = parseDateArg();
  const force = process.argv.includes("--force");
  const env = sanitizedEnv();
  const nodeBin = process.execPath;

  runSyncStep({ nodeBin, env, date, force });
  runPreviewStep({ nodeBin, env, date });
}

main();
