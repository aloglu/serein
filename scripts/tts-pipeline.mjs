import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileExists, stableHash } from "./tts-manifest.mjs";

export function readArgValue(flagName, argv = process.argv) {
  const index = argv.indexOf(flagName);
  if (index < 0) {
    return "";
  }
  return String(argv[index + 1] || "").trim();
}

export function selectedDates(argv = process.argv) {
  const raw = readArgValue("--date", argv);
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

export function assetKeyForPoem({ poem, profile, sourceHash }) {
  return stableHash(JSON.stringify({
    date: poem.date,
    sourceHash,
    renderProfile: profile.renderProfile,
    provider: profile.provider,
    modelId: profile.modelId,
    voice: profile.voice,
    outputFormat: profile.outputFormat,
    instructions: profile.instructions,
    speed: profile.speed
  }));
}

export async function listManagedAudioFiles(dirPath) {
  if (!(await fileExists(dirPath))) {
    return [];
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listManagedAudioFiles(fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}
