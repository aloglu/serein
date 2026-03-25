import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { speakablePoetryLineDirective } from "./poetry-line.mjs";
import { verbalizeStandaloneNumbers } from "./number-words.mjs";
import { repairMojibakeText } from "./mojibake.mjs";

export const TTS_MANIFEST_VERSION = 2;

export function ttsRootDir(root = process.cwd()) {
  return path.join(root, "assets", "tts");
}

export function ttsAudioDir(root = process.cwd()) {
  return path.join(ttsRootDir(root), "audio");
}

export function ttsTimingsDir(root = process.cwd()) {
  return path.join(ttsRootDir(root), "timings");
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

export function repairMojibakePunctuation(input) {
  return repairMojibakeText(input);
  const source = String(input || "");
  if (!/[ÃÂâ]/.test(source)) {
    return source;
  }

  try {
    const repaired = Buffer.from(source, "latin1").toString("utf8");
    if (!repaired || repaired.includes("\uFFFD")) {
      return source;
    }
    return repaired.replaceAll("\u00c2\u00a0", "\u00a0");
  } catch {
    return source;
  }
}

export function speakablePoemText(poemBody) {
  const lines = normalizeNewlines(repairMojibakePunctuation(poemBody))
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return "";
      }
      if (trimmed.startsWith("::line")) {
        return speakablePoetryLineDirective(trimmed) ?? String(trimmed).replace(/^::line\s*/, "").trim();
      }
      return verbalizeStandaloneNumbers(line.replace(/\s+$/g, ""));
    });

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function speakablePoemScript(poem) {
  if (typeof poem === "string") {
    return speakablePoemText(poem);
  }

  const title = verbalizeStandaloneNumbers(repairMojibakePunctuation(String(poem?.title || ""))).trim();
  const author = verbalizeStandaloneNumbers(repairMojibakePunctuation(String(poem?.author || ""))).trim();
  const translator = verbalizeStandaloneNumbers(repairMojibakePunctuation(String(poem?.translator || ""))).trim();
  const poemText = speakablePoemText(poem?.poem || "");
  const preambleParts = [];

  if (title && author && translator) {
    preambleParts.push(`${title}, by ${author}, translated by ${translator}.`);
  } else if (title && author) {
    preambleParts.push(`${title}, by ${author}.`);
  } else if (title) {
    preambleParts.push(title);
  }

  if (!preambleParts.length) {
    return poemText;
  }
  if (!poemText) {
    return preambleParts.join("\n\n").trim();
  }

  return `${preambleParts.join("\n\n")}\n\n${poemText}`.trim();
}

export function poemSourceHash(poem) {
  return stableHash(speakablePoemScript(poem));
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
      timingsUrl: String(entry.timingsUrl || "").trim(),
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
      timingsVersion: Number.isFinite(Number(entry.timingsVersion)) ? Number(entry.timingsVersion) : null,
      visibleWordCount: Number.isFinite(Number(entry.visibleWordCount)) ? Number(entry.visibleWordCount) : null,
      matchedWordCount: Number.isFinite(Number(entry.matchedWordCount)) ? Number(entry.matchedWordCount) : null,
      coverage: Number.isFinite(Number(entry.coverage)) ? Number(entry.coverage) : null,
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
