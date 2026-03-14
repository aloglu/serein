import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const TTS_MANIFEST_VERSION = 1;

export function ttsRootDir(root = process.cwd()) {
  return path.join(root, "assets", "tts");
}

export function ttsAudioDir(root = process.cwd()) {
  return path.join(ttsRootDir(root), "audio");
}

export function ttsManifestPath(root = process.cwd()) {
  return path.join(ttsRootDir(root), "manifest.json");
}

export function fileExists(targetPath) {
  return stat(targetPath).then(() => true).catch(() => false);
}

export function defaultTtsManifest() {
  return {
    version: TTS_MANIFEST_VERSION,
    poems: {}
  };
}

export function stableHash(input) {
  return createHash("sha256").update(String(input || "")).digest("hex").slice(0, 16);
}

export function normalizeNewlines(input) {
  return String(input || "").replace(/\r\n/g, "\n");
}

function spokenCustomLine(line) {
  const segments = Array.from(String(line).matchAll(/\|([<^>~])([^|]*)\|/g));
  if (segments.length === 0) {
    return String(line).replace(/^::line\s*/, "").trim();
  }

  return segments
    .filter((segment) => segment[1] !== "~")
    .map((segment) => String(segment[2] || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function speakablePoemText(poemBody) {
  const lines = normalizeNewlines(poemBody)
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return "";
      }
      if (trimmed.startsWith("::line")) {
        return spokenCustomLine(trimmed);
      }
      return line.replace(/\s+$/g, "");
    });

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function poemSourceHash(poem) {
  const source = typeof poem === "string" ? poem : poem?.poem || "";
  return stableHash(speakablePoemText(source));
}

export function audioUrlToRepoPath(audioUrl, root = process.cwd()) {
  const normalized = String(audioUrl || "").trim();
  if (!normalized.startsWith("/assets/tts/")) {
    return "";
  }
  return path.join(root, ...normalized.slice(1).split("/"));
}

export function buildManagedAudioUrl({ poem, assetKey, extension }) {
  const parts = String(poem?.date || "").split("-");
  if (parts.length !== 3) {
    throw new Error(`Invalid poem date '${poem?.date || ""}' while building TTS audio URL.`);
  }

  const basename = path.parse(String(poem?.filename || "")).name;
  if (!basename) {
    throw new Error(`Missing poem filename for '${poem?.date || ""}'.`);
  }

  return `/assets/tts/audio/${parts[0]}/${parts[1]}/${basename}.${assetKey}${extension}`;
}

export function normalizeTtsManifest(input) {
  const source = (input && typeof input === "object") ? input : {};
  const poems = (source.poems && typeof source.poems === "object" && !Array.isArray(source.poems)) ? source.poems : {};
  const normalizedEntries = {};

  for (const date of Object.keys(poems).sort()) {
    const entry = poems[date];
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const audioUrl = String(entry.audioUrl || "").trim();
    if (!audioUrl) {
      continue;
    }

    normalizedEntries[date] = {
      audioUrl,
      sourceHash: String(entry.sourceHash || "").trim(),
      assetKey: String(entry.assetKey || "").trim(),
      renderProfile: String(entry.renderProfile || "").trim(),
      provider: String(entry.provider || "").trim(),
      modelId: String(entry.modelId || "").trim(),
      voice: String(entry.voice || entry.voiceId || "").trim(),
      outputFormat: String(entry.outputFormat || "").trim(),
      mimeType: String(entry.mimeType || "").trim(),
      instructions: String(entry.instructions || "").trim(),
      speed: Number.isFinite(Number(entry.speed)) ? Number(entry.speed) : null,
      generatedAt: String(entry.generatedAt || "").trim()
    };
  }

  return {
    version: TTS_MANIFEST_VERSION,
    poems: normalizedEntries
  };
}

export async function loadTtsManifest(root = process.cwd()) {
  const manifestFile = ttsManifestPath(root);
  if (!(await fileExists(manifestFile))) {
    return defaultTtsManifest();
  }

  const raw = await readFile(manifestFile, "utf8");
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid TTS manifest JSON at '${manifestFile}': ${error?.message || error}`);
  }

  return normalizeTtsManifest(parsed);
}

export async function writeTtsManifest(manifest, root = process.cwd()) {
  const normalized = normalizeTtsManifest(manifest);
  await mkdir(ttsRootDir(root), { recursive: true });
  await writeFile(ttsManifestPath(root), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}
