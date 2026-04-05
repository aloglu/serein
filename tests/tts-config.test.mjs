import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveTtsProfile } from "../scripts/tts-config.mjs";

async function withTempProject(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "serein-tts-config-"));
  try {
    await callback(root);
  } finally {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  }
}

test("resolveTtsProfile loads OPENAI_API_KEY from .env.local when the env is missing", async () => {
  await withTempProject(async (root) => {
    await writeFile(path.join(root, ".env.local"), "OPENAI_API_KEY=from-env-local\nOPENAI_TTS_VOICE=alloy\n", "utf8");

    const profile = resolveTtsProfile({}, { root });

    assert.equal(profile.apiKey, "from-env-local");
    assert.equal(profile.voice, "alloy");
  });
});

test("resolveTtsProfile prefers explicit env vars over .env.local", async () => {
  await withTempProject(async (root) => {
    await writeFile(path.join(root, ".env.local"), "OPENAI_API_KEY=from-env-local\nOPENAI_TTS_VOICE=alloy\n", "utf8");

    const profile = resolveTtsProfile({
      OPENAI_API_KEY: "from-explicit-env",
      OPENAI_TTS_VOICE: "sage"
    }, { root });

    assert.equal(profile.apiKey, "from-explicit-env");
    assert.equal(profile.voice, "sage");
  });
});
