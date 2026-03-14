import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadPoems } from "./build.mjs";
import { assertTtsProfileIsReady, resolveTtsProfile } from "./tts-config.mjs";
import { assetKeyForPoem, listManagedAudioFiles, selectedDates } from "./tts-pipeline.mjs";
import {
  audioUrlToRepoPath,
  buildManagedAudioUrl,
  fileExists,
  loadTtsManifest,
  poemSourceHash,
  speakablePoemText,
  ttsAudioDir,
  writeTtsManifest
} from "./tts-manifest.mjs";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

async function fetchOpenAiAudio({ profile, text }) {
  const endpoint = "https://api.openai.com/v1/audio/speech";
  const body = {
    input: text,
    model: profile.modelId,
    voice: profile.voice,
    response_format: profile.outputFormat
  };

  if (profile.instructions) {
    body.instructions = profile.instructions;
  }
  if (typeof profile.speed === "number") {
    body.speed = profile.speed;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${profile.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `OpenAI request failed (${response.status} ${response.statusText}). ${errorText}`.trim()
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

async function pruneUnusedAudioFiles(activeAudioUrls) {
  const managedRoot = ttsAudioDir(root);
  const activePaths = new Set(
    Array.from(activeAudioUrls)
      .map((audioUrl) => audioUrlToRepoPath(audioUrl, root))
      .filter(Boolean)
      .map((audioPath) => path.normalize(audioPath))
  );
  const existingFiles = await listManagedAudioFiles(managedRoot);
  let deletedCount = 0;

  for (const filePath of existingFiles) {
    if (activePaths.has(path.normalize(filePath))) {
      continue;
    }

    deletedCount += 1;
    if (dryRun) {
      console.log(`Would delete stale TTS asset: ${path.relative(root, filePath)}`);
      continue;
    }

    await rm(filePath, { force: true });
    console.log(`Deleted stale TTS asset: ${path.relative(root, filePath)}`);
  }

  return deletedCount;
}

async function main() {
  const profile = resolveTtsProfile(process.env);
  const dateFilter = selectedDates();
  const poems = await loadPoems();
  const manifest = await loadTtsManifest(root);
  const nextManifest = { version: manifest.version, poems: {} };
  const activeAudioUrls = new Set();

  if (!dryRun) {
    assertTtsProfileIsReady(profile);
  }

  let generated = 0;
  let skipped = 0;
  let deleted = 0;

  for (const poem of poems) {
    if (dateFilter.size > 0 && !dateFilter.has(poem.date)) {
      const existingEntry = manifest.poems[poem.date];
      if (existingEntry?.audioUrl) {
        nextManifest.poems[poem.date] = existingEntry;
        activeAudioUrls.add(existingEntry.audioUrl);
      }
      continue;
    }

    const speakableText = speakablePoemText(poem.poem);
    const sourceHash = poemSourceHash(poem);
    const assetKey = assetKeyForPoem({ poem, profile, sourceHash });
    const audioUrl = buildManagedAudioUrl({
      poem,
      assetKey,
      extension: profile.extension
    });
    const existingEntry = manifest.poems[poem.date];
    const existingPath = existingEntry?.audioUrl ? audioUrlToRepoPath(existingEntry.audioUrl, root) : "";
    const existingMatches = (
      !force
      && existingEntry?.sourceHash === sourceHash
      && existingEntry?.assetKey === assetKey
      && existingEntry?.renderProfile === profile.renderProfile
      && existingEntry?.provider === profile.provider
      && await fileExists(existingPath)
    );

    if (existingMatches) {
      skipped += 1;
      nextManifest.poems[poem.date] = existingEntry;
      activeAudioUrls.add(existingEntry.audioUrl);
      console.log(`Skipped ${poem.date} ${poem.title}`);
      continue;
    }

    if (dryRun) {
      generated += 1;
      nextManifest.poems[poem.date] = {
        audioUrl,
        sourceHash,
        assetKey,
        renderProfile: profile.renderProfile,
        provider: profile.provider,
        modelId: profile.modelId,
        voice: profile.voice,
        outputFormat: profile.outputFormat,
        mimeType: profile.mimeType,
        instructions: profile.instructions,
        speed: profile.speed,
        generatedAt: new Date().toISOString()
      };
      activeAudioUrls.add(audioUrl);
      console.log(`Would generate ${poem.date} ${poem.title}`);
      continue;
    }

    console.log(`Generating ${poem.date} ${poem.title}`);
    const audioBuffer = await fetchOpenAiAudio({ profile, text: speakableText });
    const outputPath = audioUrlToRepoPath(audioUrl, root);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, audioBuffer);

    generated += 1;
    nextManifest.poems[poem.date] = {
      audioUrl,
      sourceHash,
      assetKey,
      renderProfile: profile.renderProfile,
      provider: profile.provider,
      modelId: profile.modelId,
      voice: profile.voice,
      outputFormat: profile.outputFormat,
      mimeType: profile.mimeType,
      instructions: profile.instructions,
      speed: profile.speed,
      generatedAt: new Date().toISOString()
    };
    activeAudioUrls.add(audioUrl);
  }

  deleted = await pruneUnusedAudioFiles(activeAudioUrls);

  if (!dryRun) {
    await writeTtsManifest(nextManifest, root);
  }

  console.log("");
  console.log(`TTS sync complete for profile ${profile.renderProfile}.`);
  console.log(`Generated: ${generated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Deleted stale assets: ${deleted}`);
  if (dryRun) {
    console.log("Dry run only; no files were written.");
  }
}

await main();
