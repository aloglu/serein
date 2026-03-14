import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);
const serveCliPath = require.resolve("serve/build/main.js");

function readArgValue(flagName) {
  const exactIndex = process.argv.indexOf(flagName);
  if (exactIndex >= 0) {
    return process.argv[exactIndex + 1] || "";
  }
  return "";
}

function parseAsOfArg() {
  const raw = String(readArgValue("--as-of") || readArgValue("--date") || "").trim();
  if (!raw) {
    return "";
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

function buildArgs({ asOf, watch }) {
  const args = ["scripts/build.mjs"];
  if (watch) {
    args.push("--watch");
  }
  if (asOf) {
    args.push("--as-of", asOf);
  }
  return args;
}

function run() {
  const asOf = parseAsOfArg();
  const watch = process.argv.includes("--watch");
  const env = sanitizedEnv();
  const nodeBin = process.execPath;

  const initialBuild = spawnSync(nodeBin, buildArgs({ asOf, watch: false }), {
    stdio: "inherit",
    env
  });
  if ((initialBuild.status ?? 0) !== 0) {
    process.exit(initialBuild.status ?? 1);
  }
  if (initialBuild.signal) {
    process.exit(1);
  }

  const processes = [];
  if (watch) {
    processes.push({
      name: "build",
      child: spawn(nodeBin, buildArgs({ asOf, watch: true }), { stdio: "inherit", env })
    });
  }
  processes.push({
    name: "serve",
    child: spawn(nodeBin, [serveCliPath, "dist"], { stdio: "inherit", env })
  });

  let shuttingDown = false;
  const terminate = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    for (const processEntry of processes) {
      processEntry.child.kill("SIGTERM");
    }
  };

  const onExit = (name, code, signal) => {
    const terminatedByExpectedSignal = shuttingDown && (signal === "SIGTERM" || signal === "SIGINT");
    if (code === 0 || terminatedByExpectedSignal) {
      terminate();
      process.exit(0);
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`${name} exited with ${reason}`);
    terminate();
    process.exit(code ?? 1);
  };

  for (const processEntry of processes) {
    processEntry.child.on("exit", (code, signal) => {
      onExit(processEntry.name, code, signal);
    });
  }

  process.on("SIGINT", terminate);
  process.on("SIGTERM", terminate);
}

run();
