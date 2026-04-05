import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

export const DEFAULT_TTS_RENDER_PROFILE = "house-default-v1";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parsedEnvFileCache = new Map();

const PROFILE_DEFAULTS = {
  "house-default-v1": {
    provider: "openai",
    modelId: "gpt-4o-mini-tts",
    outputFormat: "mp3",
    voice: "sage",
    instructions: "Read this poem aloud with calm, attentive pacing. Respect line breaks as natural pauses and keep the delivery intimate rather than theatrical. Read every line exactly once, including isolated final lines and single-word final lines.",
    speed: 0.96
  }
};

export function extensionForOutputFormat(outputFormat) {
  const normalized = String(outputFormat || "").trim().toLowerCase();

  if (normalized.startsWith("mp3")) {
    return ".mp3";
  }
  if (normalized.startsWith("wav")) {
    return ".wav";
  }
  if (normalized.startsWith("opus")) {
    return ".opus";
  }
  if (normalized.startsWith("aac")) {
    return ".aac";
  }
  if (normalized.startsWith("flac")) {
    return ".flac";
  }
  if (normalized.startsWith("pcm")) {
    return ".pcm";
  }

  return ".bin";
}

export function mimeTypeForOutputFormat(outputFormat) {
  const normalized = String(outputFormat || "").trim().toLowerCase();

  if (normalized.startsWith("mp3")) {
    return "audio/mpeg";
  }
  if (normalized.startsWith("wav")) {
    return "audio/wav";
  }
  if (normalized.startsWith("opus")) {
    return "audio/opus";
  }
  if (normalized.startsWith("aac")) {
    return "audio/aac";
  }
  if (normalized.startsWith("flac")) {
    return "audio/flac";
  }
  if (normalized.startsWith("pcm")) {
    return "audio/pcm";
  }

  return "application/octet-stream";
}

function parseNumberEnv(name, env = process.env) {
  const raw = String(env[name] || "").trim();
  if (!raw) {
    return null;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value in ${name}: '${raw}'.`);
  }

  return value;
}

function readParsedEnvFile(targetPath) {
  const cached = parsedEnvFileCache.get(targetPath);
  if (cached) {
    return cached;
  }

  try {
    const parsed = parseEnv(readFileSync(targetPath, "utf8"));
    parsedEnvFileCache.set(targetPath, parsed);
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") {
      parsedEnvFileCache.set(targetPath, {});
      return {};
    }
    throw error;
  }
}

function mergedEnvWithLocalFallback(env, root = projectRoot) {
  const envFilePath = path.join(root, ".env.local");
  return {
    ...readParsedEnvFile(envFilePath),
    ...env
  };
}

export function resolveTtsProfile(env = process.env, { root = projectRoot } = {}) {
  const resolvedEnv = mergedEnvWithLocalFallback(env, root);
  const renderProfile = String(resolvedEnv.TTS_RENDER_PROFILE || DEFAULT_TTS_RENDER_PROFILE).trim() || DEFAULT_TTS_RENDER_PROFILE;
  const defaults = PROFILE_DEFAULTS[renderProfile];

  if (!defaults) {
    throw new Error(`Unknown TTS render profile '${renderProfile}'.`);
  }

  const outputFormat = String(resolvedEnv.OPENAI_TTS_RESPONSE_FORMAT || defaults.outputFormat).trim() || defaults.outputFormat;
  const modelId = String(resolvedEnv.OPENAI_TTS_MODEL || defaults.modelId).trim() || defaults.modelId;
  const voice = String(resolvedEnv.OPENAI_TTS_VOICE || defaults.voice).trim() || defaults.voice;
  const instructions = String(resolvedEnv.OPENAI_TTS_INSTRUCTIONS || defaults.instructions).trim() || defaults.instructions;
  const speed = parseNumberEnv("OPENAI_TTS_SPEED", resolvedEnv) ?? defaults.speed;

  return {
    renderProfile,
    provider: defaults.provider,
    apiKey: String(resolvedEnv.OPENAI_API_KEY || "").trim(),
    voice,
    modelId,
    outputFormat,
    mimeType: mimeTypeForOutputFormat(outputFormat),
    extension: extensionForOutputFormat(outputFormat),
    instructions,
    speed
  };
}

export function assertTtsProfileIsReady(profile) {
  if (!profile?.apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }
}
