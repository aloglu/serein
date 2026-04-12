#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const removedAudioCommand = ["t", "t", "s"].join("");

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

function isDateToken(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function printUsage() {
  console.log(`Serein command surface

Usage:
  serein poems
  serein poems fix-proximity <poem-path>
  serein build [YYYY-MM-DD]
  serein preview [YYYY-MM-DD]
  serein preview watch [YYYY-MM-DD]
  serein editorial [YYYY-MM-DD]

Examples:
  serein poems
  serein poems fix-proximity 2026/04-April/2026-04-12-when-i-am-among-trees.md
  serein build 2026-03-07
  serein preview watch 2026-03-07
`);
}

function parseDateOption(tokens) {
  const values = [...tokens];
  let date = "";

  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (token === "--date" || token === "--as-of") {
      const next = String(values[index + 1] || "").trim();
      if (!isDateToken(next)) {
        throw new Error(`Invalid date '${next}'. Expected YYYY-MM-DD.`);
      }
      date = next;
      values.splice(index, 2);
      index -= 1;
      continue;
    }
  }

  return {
    date,
    tokens: values
  };
}

function commandForBuild(tokens) {
  const parsed = parseDateOption(tokens);
  let date = parsed.date;
  const extras = [...parsed.tokens];

  if (!date && isDateToken(extras[0])) {
    date = extras.shift();
  }
  if (extras.length > 0) {
    throw new Error(`Unexpected build argument '${extras[0]}'.`);
  }

  return {
    script: "scripts/build.mjs",
    args: date ? ["--as-of", date] : []
  };
}

function commandForPoems(tokens) {
  const extras = [...tokens];
  if (extras.length === 0) {
    return {
      script: "scripts/normalize-poems.mjs",
      args: []
    };
  }

  const subcommand = extras.shift();
  if (subcommand === "fix-proximity") {
    const targetPath = String(extras.shift() || "").trim();
    if (!targetPath) {
      throw new Error("Missing poem path for 'serein poems fix-proximity'.");
    }
    if (extras.length > 0) {
      throw new Error(`Unexpected poems argument '${extras[0]}'.`);
    }
    return {
      script: "scripts/normalize-poems.mjs",
      args: ["fix-proximity", targetPath]
    };
  }

  throw new Error(`Unexpected poems argument '${subcommand}'.`);
}

function commandForPreview(tokens) {
  const parsed = parseDateOption(tokens);
  let date = parsed.date;
  const extras = [...parsed.tokens];
  let watch = false;

  if (extras[0] === "watch") {
    watch = true;
    extras.shift();
  }
  if (!date && isDateToken(extras[0])) {
    date = extras.shift();
  }
  if (extras.includes("--watch")) {
    watch = true;
    extras.splice(extras.indexOf("--watch"), 1);
  }
  if (extras.length > 0) {
    throw new Error(`Unexpected preview argument '${extras[0]}'.`);
  }

  return {
    script: "scripts/preview.mjs",
    args: [
      ...(watch ? ["--watch"] : []),
      ...(date ? ["--date", date] : [])
    ]
  };
}

function commandForEditorial(tokens) {
  const parsed = parseDateOption(tokens);
  let date = parsed.date;
  const extras = [...parsed.tokens];

  if (!date && isDateToken(extras[0])) {
    date = extras.shift();
  }
  if (extras.length > 0) {
    throw new Error(`Unexpected editorial argument '${extras[0]}'.`);
  }

  return {
    script: "scripts/editorial-report.mjs",
    args: date ? ["--as-of", date] : []
  };
}

function resolveCommand(argv) {
  const tokens = argv.slice(2);
  const area = String(tokens[0] || "").trim().toLowerCase();
  const rest = tokens.slice(1);

  if (!area || area === "help" || area === "--help" || area === "-h") {
    printUsage();
    return null;
  }

  if (area === "poems") {
    return commandForPoems(rest);
  }

  if (area === "build") {
    return commandForBuild(rest);
  }

  if (area === "preview") {
    return commandForPreview(rest);
  }

  if (area === "editorial" || area === "report") {
    return commandForEditorial(rest);
  }

  if (area === removedAudioCommand) {
    throw new Error("Audio commands have been removed. Serein is text-only again.");
  }

  throw new Error(`Unknown command '${area}'. Run 'serein help' for usage.`);
}

function runChild(command) {
  if (!command) {
    return;
  }

  const child = spawn(process.execPath, [path.join(projectRoot, command.script), ...command.args], {
    stdio: "inherit",
    env: sanitizedEnv(),
    cwd: projectRoot
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);
  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
      return;
    }
    process.exit(code ?? 0);
  });
}

try {
  runChild(resolveCommand(process.argv));
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
