import path from "node:path";
import process from "node:process";
import { loadPoems } from "./build.mjs";
import { resolveTtsProfile } from "./tts-config.mjs";
import { assetKeyForPoem, listManagedAudioFiles, selectedDates } from "./tts-pipeline.mjs";
import {
  audioUrlToRepoPath,
  buildManagedAudioUrl,
  fileExists,
  loadTtsManifest,
  poemSourceHash,
  ttsAudioDir
} from "./tts-manifest.mjs";

const root = process.cwd();

function expectedEntryForPoem(poem, profile) {
  const sourceHash = poemSourceHash(poem);
  const assetKey = assetKeyForPoem({ poem, profile, sourceHash });
  const audioUrl = buildManagedAudioUrl({
    poem,
    assetKey,
    extension: profile.extension
  });

  return {
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
    speed: profile.speed
  };
}

function compareEntry(entry, expected, label) {
  const issues = [];
  const fields = [
    ["audioUrl", entry?.audioUrl, expected.audioUrl],
    ["sourceHash", entry?.sourceHash, expected.sourceHash],
    ["assetKey", entry?.assetKey, expected.assetKey],
    ["renderProfile", entry?.renderProfile, expected.renderProfile],
    ["provider", entry?.provider, expected.provider],
    ["modelId", entry?.modelId, expected.modelId],
    ["voice", entry?.voice, expected.voice],
    ["outputFormat", entry?.outputFormat, expected.outputFormat],
    ["mimeType", entry?.mimeType, expected.mimeType],
    ["instructions", entry?.instructions, expected.instructions],
    ["speed", entry?.speed, expected.speed]
  ];

  for (const [field, actual, wanted] of fields) {
    if (actual !== wanted) {
      issues.push(`${label}: manifest ${field} is '${actual ?? ""}' but expected '${wanted ?? ""}'.`);
    }
  }

  return issues;
}

async function main() {
  const profile = resolveTtsProfile(process.env);
  const dateFilter = selectedDates();
  const poems = await loadPoems();
  const manifest = await loadTtsManifest(root);
  const issues = [];
  const expectedDates = new Set();
  const activeAudioUrls = new Set();

  for (const poem of poems) {
    if (dateFilter.size > 0 && !dateFilter.has(poem.date)) {
      continue;
    }

    expectedDates.add(poem.date);
    const label = `${poem.date} ${poem.title}`;
    const expected = expectedEntryForPoem(poem, profile);
    const entry = manifest.poems[poem.date];
    activeAudioUrls.add(expected.audioUrl);

    if (!entry) {
      issues.push(`${label}: missing manifest entry.`);
      continue;
    }

    issues.push(...compareEntry(entry, expected, label));

    const audioPath = audioUrlToRepoPath(entry.audioUrl, root);
    if (!audioPath || !(await fileExists(audioPath))) {
      issues.push(`${label}: missing committed audio file '${entry.audioUrl}'.`);
    }
  }

  if (dateFilter.size === 0) {
    for (const manifestDate of Object.keys(manifest.poems || {})) {
      if (!expectedDates.has(manifestDate)) {
        issues.push(`${manifestDate}: stale manifest entry for a poem that is no longer present.`);
      }
    }

    const activeAudioPaths = new Set(
      Array.from(activeAudioUrls)
        .map((audioUrl) => audioUrlToRepoPath(audioUrl, root))
        .filter(Boolean)
        .map((audioPath) => path.normalize(audioPath))
    );
    const existingFiles = await listManagedAudioFiles(ttsAudioDir(root));

    for (const filePath of existingFiles) {
      if (!activeAudioPaths.has(path.normalize(filePath))) {
        issues.push(`Stale committed audio file '${path.relative(root, filePath)}'.`);
      }
    }
  }

  if (issues.length > 0) {
    console.error(`TTS assets are out of date for profile ${profile.renderProfile}.`);
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    console.error("");
    console.error("Run `npm run tts:sync` locally and commit the updated assets.");
    process.exit(1);
  }

  const scope = dateFilter.size > 0 ? `${dateFilter.size} selected date(s)` : `${expectedDates.size} poem(s)`;
  console.log(`TTS assets are up to date for profile ${profile.renderProfile} across ${scope}.`);
}

await main();
