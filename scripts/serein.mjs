#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

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
  serein build [YYYY-MM-DD]
  serein preview [YYYY-MM-DD]
  serein preview watch [YYYY-MM-DD]
  serein editorial [YYYY-MM-DD]
  serein tts [YYYY-MM-DD] [--force]
  serein tts align [YYYY-MM-DD] [--force]
  serein tts preview YYYY-MM-DD [--force]

Examples:
  serein poems
  serein build 2026-03-07
  serein preview watch 2026-03-07
  serein tts
  serein tts 2026-03-07
  serein tts align 2026-03-07
  serein tts align --force
  serein tts preview 2026-03-07 --force
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

function extractForceFlag(tokens) {
  const values = [];
  let force = false;

  for (const token of tokens) {
    if (token === "--force") {
      force = true;
      continue;
    }
    values.push(token);
  }

  return {
    force,
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

function commandForTts(tokens) {
  const forced = extractForceFlag(tokens);
  const parsed = parseDateOption(forced.tokens);
  let date = parsed.date;
  const extras = [...parsed.tokens];

  if (extras[0] === "align") {
    extras.shift();
    if (!date && isDateToken(extras[0])) {
      date = extras.shift();
    }
    if (extras.length > 0) {
      throw new Error(`Unexpected tts align argument '${extras[0]}'.`);
    }
    return {
      script: "scripts/tts-align.mjs",
      args: [
        ...(date ? ["--date", date] : []),
        ...(forced.force ? ["--force"] : [])
      ]
    };
  }

  if (extras[0] === "preview") {
    extras.shift();
    if (!date && isDateToken(extras[0])) {
      date = extras.shift();
    }
    if (!date) {
      throw new Error("Missing date for 'serein tts preview'. Expected YYYY-MM-DD.");
    }
    if (extras.length > 0) {
      throw new Error(`Unexpected tts preview argument '${extras[0]}'.`);
    }
    return {
      script: "scripts/tts-preview.mjs",
      args: [
        "--date",
        date,
        ...(forced.force ? ["--force"] : [])
      ]
    };
  }

  if (!date && isDateToken(extras[0])) {
    date = extras.shift();
  }
  if (extras.length > 0) {
    throw new Error(`Unexpected tts argument '${extras[0]}'.`);
  }

  return {
    script: "scripts/tts-sync.mjs",
    args: [
      ...(date ? ["--date", date] : []),
      ...(forced.force ? ["--force"] : [])
    ]
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
    if (rest.length > 0) {
      throw new Error(`Unexpected poems argument '${rest[0]}'.`);
    }
    return {
      script: "scripts/normalize-poems.mjs",
      args: []
    };
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

  if (area === "tts") {
    return commandForTts(rest);
  }

  throw new Error(`Unknown command '${area}'. Run 'serein help' for usage.`);
}

function runChild(command) {
  if (!command) {
    return;
  }

  const child = spawn(process.execPath, [command.script, ...command.args], {
    stdio: "inherit",
    env: sanitizedEnv()
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
