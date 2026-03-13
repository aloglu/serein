import { spawn } from "node:child_process";
import process from "node:process";

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

function run() {
  const asOf = parseAsOfArg();
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

  const nodeBin = process.execPath;
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("Could not resolve npm CLI path from npm_execpath.");
  }
  const buildArgs = ["scripts/build.mjs", "--watch"];
  if (asOf) {
    buildArgs.push("--as-of", asOf);
  }
  const build = spawn(nodeBin, buildArgs, { stdio: "inherit", env });
  const serve = spawn(nodeBin, [npmCli, "run", "preview"], { stdio: "inherit", env });

  let shuttingDown = false;
  const terminate = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    build.kill("SIGTERM");
    serve.kill("SIGTERM");
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

  build.on("exit", (code, signal) => {
    onExit("build", code, signal);
  });

  serve.on("exit", (code, signal) => {
    onExit("serve", code, signal);
  });

  process.on("SIGINT", terminate);
  process.on("SIGTERM", terminate);
}

run();
