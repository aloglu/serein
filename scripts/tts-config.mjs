export const DEFAULT_TTS_RENDER_PROFILE = "house-default-v1";

const PROFILE_DEFAULTS = {
  "house-default-v1": {
    provider: "openai",
    modelId: "gpt-4o-mini-tts",
    outputFormat: "mp3",
    voice: "sage",
    instructions: "Read this poem aloud with calm, attentive pacing. Respect line breaks as natural pauses and keep the delivery intimate rather than theatrical.",
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

export function resolveTtsProfile(env = process.env) {
  const renderProfile = String(env.TTS_RENDER_PROFILE || DEFAULT_TTS_RENDER_PROFILE).trim() || DEFAULT_TTS_RENDER_PROFILE;
  const defaults = PROFILE_DEFAULTS[renderProfile];

  if (!defaults) {
    throw new Error(`Unknown TTS render profile '${renderProfile}'.`);
  }

  const outputFormat = String(env.OPENAI_TTS_RESPONSE_FORMAT || defaults.outputFormat).trim() || defaults.outputFormat;
  const modelId = String(env.OPENAI_TTS_MODEL || defaults.modelId).trim() || defaults.modelId;
  const voice = String(env.OPENAI_TTS_VOICE || defaults.voice).trim() || defaults.voice;
  const instructions = String(env.OPENAI_TTS_INSTRUCTIONS || defaults.instructions).trim() || defaults.instructions;
  const speed = parseNumberEnv("OPENAI_TTS_SPEED", env) ?? defaults.speed;

  return {
    renderProfile,
    provider: defaults.provider,
    apiKey: String(env.OPENAI_API_KEY || "").trim(),
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
