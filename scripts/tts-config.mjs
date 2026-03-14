function parseJsonEnv(name, env = process.env) {
  const raw = String(env[name] || "").trim();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${name}: ${error?.message || error}`);
  }
}

export const DEFAULT_TTS_RENDER_PROFILE = "house-default-v1";

const PROFILE_DEFAULTS = {
  "house-default-v1": {
    provider: "elevenlabs",
    modelId: "eleven_multilingual_v2",
    outputFormat: "mp3_44100_128",
    voiceSettings: {
      stability: 0.45,
      similarity_boost: 0.75,
      style: 0.2,
      speed: 0.96,
      use_speaker_boost: true
    }
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
  if (normalized.startsWith("pcm")) {
    return ".pcm";
  }
  if (normalized.startsWith("ulaw")) {
    return ".ulaw";
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
  if (normalized.startsWith("pcm")) {
    return "audio/pcm";
  }
  if (normalized.startsWith("ulaw")) {
    return "audio/basic";
  }

  return "application/octet-stream";
}

export function resolveTtsProfile(env = process.env) {
  const renderProfile = String(env.TTS_RENDER_PROFILE || DEFAULT_TTS_RENDER_PROFILE).trim() || DEFAULT_TTS_RENDER_PROFILE;
  const defaults = PROFILE_DEFAULTS[renderProfile];

  if (!defaults) {
    throw new Error(`Unknown TTS render profile '${renderProfile}'.`);
  }

  const voiceSettings = parseJsonEnv("ELEVENLABS_VOICE_SETTINGS", env) || defaults.voiceSettings;
  const outputFormat = String(env.ELEVENLABS_OUTPUT_FORMAT || defaults.outputFormat).trim() || defaults.outputFormat;
  const modelId = String(env.ELEVENLABS_MODEL_ID || defaults.modelId).trim() || defaults.modelId;

  return {
    renderProfile,
    provider: defaults.provider,
    apiKey: String(env.ELEVENLABS_API_KEY || "").trim(),
    voiceId: String(env.ELEVENLABS_VOICE_ID || "").trim(),
    modelId,
    outputFormat,
    mimeType: mimeTypeForOutputFormat(outputFormat),
    extension: extensionForOutputFormat(outputFormat),
    voiceSettings,
    enableLogging: String(env.ELEVENLABS_ENABLE_LOGGING || "true").trim().toLowerCase() !== "false"
  };
}

export function assertTtsProfileIsReady(profile) {
  if (!profile?.apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY.");
  }
  if (!profile?.voiceId) {
    throw new Error("Missing ELEVENLABS_VOICE_ID.");
  }
}
