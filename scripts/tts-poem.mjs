import { spawnSync } from "node:child_process";
import process from "node:process";

function readArgValue(flagName) {
  const index = process.argv.indexOf(flagName);
  if (index < 0) {
    return "";
  }
  return String(process.argv[index + 1] || "").trim();
}

function parseDateArg() {
  const raw = readArgValue("--date");
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

function main() {
  const date = parseDateArg();
  const result = spawnSync(process.execPath, ["scripts/tts-sync.mjs", "--date", date, "--force"], {
    stdio: "inherit",
    env: sanitizedEnv()
  });

  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1);
  }
  if (result.signal) {
    process.exit(1);
  }
}

main();
