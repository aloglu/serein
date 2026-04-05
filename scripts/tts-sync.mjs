import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { loadPoems } from "./build.mjs";
import { assertTtsProfileIsReady, resolveTtsProfile } from "./tts-config.mjs";
import { assetKeyForPoem, listManagedFiles, selectedDates } from "./tts-pipeline.mjs";
import {
  alignmentPoemScript,
  audioUrlToRepoPath,
  buildManagedAudioUrl,
  fileExists,
  loadTtsManifest,
  poemSourceHash,
  speakablePoemScript,
  ttsAudioDir,
  ttsTimingsDir,
  writeTtsManifest
} from "./tts-manifest.mjs";
import {
  alignVisibleWordTimings,
  buildManagedTimingsUrl,
  parseTextGridWordIntervals,
  timingsUrlToRepoPath,
  TTS_TIMINGS_VERSION
} from "./tts-timings.mjs";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const alignOnly = process.argv.includes("--align-only");
const defaultMfaRootDir = path.join(root, ".mfa");

function poemTtsDisabled(poem) {
  return String(poem?.tts || poem?.tty || "").trim().toLowerCase() === "no";
}

function uniqueNonEmpty(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function executablePathEntries(prefix) {
  if (!prefix) {
    return [];
  }

  if (process.platform === "win32") {
    return [
      path.join(prefix, "Library", "bin"),
      path.join(prefix, "Scripts"),
      prefix
    ];
  }

  return [path.join(prefix, "bin")];
}

function resolveManagedCommand(commandName, candidatePrefixes) {
  for (const prefix of candidatePrefixes) {
    const searchDirs = executablePathEntries(prefix);
    for (const dirPath of searchDirs) {
      const executable = path.join(
        dirPath,
        process.platform === "win32" ? `${commandName}.exe` : commandName
      );
      if (!existsSync(executable)) {
        continue;
      }

      return {
        command: executable,
        pathPrefix: searchDirs
      };
    }
  }

  return null;
}

function resolveMfaToolchain() {
  const explicit = String(process.env.SEREIN_MFA_EXE || "").trim();
  const explicitFfmpeg = String(process.env.SEREIN_FFMPEG_EXE || "").trim();

  const envPrefix = String(process.env.SEREIN_MFA_PREFIX || "").trim();
  const candidatePrefixes = [
    envPrefix,
    path.join(root, ".mamba", "envs", "mfa-env")
  ].filter(Boolean);
  const managedMfa = resolveManagedCommand("mfa", candidatePrefixes);
  const managedFfmpeg = resolveManagedCommand("ffmpeg", candidatePrefixes);

  return {
    mfaCommand: explicit || managedMfa?.command || "mfa",
    ffmpegCommand: explicitFfmpeg || managedFfmpeg?.command || "ffmpeg",
    pathPrefix: uniqueNonEmpty([
      ...(managedMfa?.pathPrefix || []),
      ...(managedFfmpeg?.pathPrefix || [])
    ]),
    mfaRootDir: String(process.env.MFA_ROOT_DIR || defaultMfaRootDir).trim() || defaultMfaRootDir
  };
}

function runCommand(command, args, { cwd = root, extraPath = [], extraEnv = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...extraEnv,
        PATH: [...extraPath.filter(Boolean), process.env.PATH || ""].join(path.delimiter)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(new Error(`${command} failed to start. ${error?.message || error}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed (${code}).\n${stdout}\n${stderr}`.trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function alignWithMfa({ poem, mp3Path }) {
  const toolchain = resolveMfaToolchain();
  const workDir = await mkdtemp(path.join(tmpdir(), "serein-mfa-"));
  const corpusDir = path.join(workDir, "corpus");
  const outputDir = path.join(workDir, "aligned");
  const caseId = String(poem?.date || "poem");
  const wavPath = path.join(corpusDir, `${caseId}.wav`);
  const textPath = path.join(corpusDir, `${caseId}.txt`);
  const textGridPath = path.join(outputDir, `${caseId}.TextGrid`);

  try {
    await mkdir(corpusDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await mkdir(toolchain.mfaRootDir, { recursive: true });
    await writeFile(textPath, `${alignmentPoemScript(poem)}\n`, "utf8");
    await runCommand(toolchain.ffmpegCommand, ["-y", "-i", mp3Path, "-ar", "16000", "-ac", "1", wavPath], {
      extraPath: toolchain.pathPrefix
    });

    const alignmentAttempts = [
      [],
      ["--beam", "100", "--retry_beam", "400"]
    ];

    let lastError = null;
    for (const extraArgs of alignmentAttempts) {
      try {
        await runCommand(toolchain.mfaCommand, [
          "align",
          corpusDir,
          "english_us_arpa",
          "english_us_arpa",
          outputDir,
          "--clean",
          "--single_speaker",
          ...extraArgs
        ], {
          extraPath: toolchain.pathPrefix,
          extraEnv: {
            MFA_ROOT_DIR: toolchain.mfaRootDir
          }
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (!/NoAlignmentsError/.test(String(error?.message || ""))) {
          throw error;
        }
        if (extraArgs.length > 0) {
          throw error;
        }
        console.warn(`Retrying MFA alignment for ${poem?.date || ""} ${poem?.title || ""} with wider beam settings.`);
      }
    }

    if (lastError) {
      throw lastError;
    }

    const textGrid = await readFile(textGridPath, "utf8");
    return alignVisibleWordTimings(poem, parseTextGridWordIntervals(textGrid));
  } catch (error) {
    throw new Error(
      `MFA alignment failed for ${poem?.date || ""} ${poem?.title || ""}. `
      + `Ensure Montreal Forced Aligner, its English models, and ffmpeg are available. `
      + `${error?.message || error}`.trim()
    );
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

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
  const existingFiles = await listManagedFiles(managedRoot);
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

async function pruneUnusedTimingFiles(activeTimingUrls) {
  const managedRoot = ttsTimingsDir(root);
  const activePaths = new Set(
    Array.from(activeTimingUrls)
      .map((timingsUrl) => timingsUrlToRepoPath(timingsUrl, root))
      .filter(Boolean)
      .map((timingsPath) => path.normalize(timingsPath))
  );
  const existingFiles = await listManagedFiles(managedRoot);
  let deletedCount = 0;

  for (const filePath of existingFiles) {
    if (activePaths.has(path.normalize(filePath))) {
      continue;
    }

    deletedCount += 1;
    if (dryRun) {
      console.log(`Would delete stale TTS timings: ${path.relative(root, filePath)}`);
      continue;
    }

    await rm(filePath, { force: true });
    console.log(`Deleted stale TTS timings: ${path.relative(root, filePath)}`);
  }

  return deletedCount;
}

async function removeSupersededAudioFile(audioUrl) {
  const targetPath = audioUrlToRepoPath(audioUrl, root);
  if (!targetPath || !(await fileExists(targetPath))) {
    return false;
  }

  if (dryRun) {
    console.log(`Would delete stale TTS asset: ${path.relative(root, targetPath)}`);
    return true;
  }

  await rm(targetPath, { force: true });
  console.log(`Deleted stale TTS asset: ${path.relative(root, targetPath)}`);
  return true;
}

async function removeSupersededTimingFile(timingsUrl) {
  const targetPath = timingsUrlToRepoPath(timingsUrl, root);
  if (!targetPath || !(await fileExists(targetPath))) {
    return false;
  }

  if (dryRun) {
    console.log(`Would delete stale TTS timings: ${path.relative(root, targetPath)}`);
    return true;
  }

  await rm(targetPath, { force: true });
  console.log(`Deleted stale TTS timings: ${path.relative(root, targetPath)}`);
  return true;
}

async function main() {
  const profile = resolveTtsProfile(process.env);
  const dateFilter = selectedDates();
  const poems = await loadPoems();
  const manifest = await loadTtsManifest(root);
  const nextManifest = { version: manifest.version, poems: {} };
  const activeAudioUrls = new Set();
  const activeTimingUrls = new Set();

  if (!dryRun && !alignOnly) {
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
        if (existingEntry.timingsUrl) {
          activeTimingUrls.add(existingEntry.timingsUrl);
        }
      }
      continue;
    }

    if (poemTtsDisabled(poem)) {
      const existingEntry = manifest.poems[poem.date];
      if (existingEntry?.audioUrl) {
        const removed = await removeSupersededAudioFile(existingEntry.audioUrl);
        if (removed) {
          deleted += 1;
        }
      }
      if (existingEntry?.timingsUrl) {
        const removed = await removeSupersededTimingFile(existingEntry.timingsUrl);
        if (removed) {
          deleted += 1;
        }
      }
      console.log(`Skipped ${poem.date} ${poem.title} (tts: no)`);
      skipped += 1;
      continue;
    }

    const speakableText = speakablePoemScript(poem);
    const sourceHash = poemSourceHash(poem);
    const assetKey = assetKeyForPoem({ poem, profile, sourceHash });
    const audioUrl = buildManagedAudioUrl({
      poem,
      assetKey,
      extension: profile.extension
    });
    const timingsUrl = buildManagedTimingsUrl({ poem, assetKey });
    const existingEntry = manifest.poems[poem.date];
    const existingPath = existingEntry?.audioUrl ? audioUrlToRepoPath(existingEntry.audioUrl, root) : "";
    const existingTimingsPath = existingEntry?.timingsUrl ? timingsUrlToRepoPath(existingEntry.timingsUrl, root) : "";
    const previousAudioUrl = existingEntry?.audioUrl || "";
    const previousTimingsUrl = existingEntry?.timingsUrl || "";
    const matchingAudioExists = (
      existingEntry?.sourceHash === sourceHash
      && existingEntry?.assetKey === assetKey
      && existingEntry?.renderProfile === profile.renderProfile
      && existingEntry?.provider === profile.provider
      && await fileExists(existingPath)
    );
    const audioMatches = (
      !force
      && matchingAudioExists
    );
    const timingsMatch = (
      !force
      && existingEntry?.timingsUrl === timingsUrl
      && existingEntry?.timingsVersion === TTS_TIMINGS_VERSION
      && Number(existingEntry?.visibleWordCount || 0) > 0
      && Number(existingEntry?.matchedWordCount || 0) > 0
      && Number(existingEntry?.coverage || 0) > 0
      && await fileExists(existingTimingsPath)
    );

    if (audioMatches && timingsMatch) {
      skipped += 1;
      nextManifest.poems[poem.date] = existingEntry;
      activeAudioUrls.add(existingEntry.audioUrl);
      activeTimingUrls.add(existingEntry.timingsUrl);
      console.log(`Skipped ${poem.date} ${poem.title}`);
      continue;
    }

    if (dryRun) {
      generated += 1;
      nextManifest.poems[poem.date] = {
        audioUrl,
        timingsUrl,
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
        timingsVersion: TTS_TIMINGS_VERSION,
        generatedAt: new Date().toISOString()
      };
      activeAudioUrls.add(audioUrl);
      activeTimingUrls.add(timingsUrl);
      console.log(alignOnly ? `Would align ${poem.date} ${poem.title}` : `Would generate ${poem.date} ${poem.title}`);
      continue;
    }

    let outputPath = audioUrlToRepoPath(audioUrl, root);
    if (matchingAudioExists) {
      console.log(`Reusing audio ${poem.date} ${poem.title}`);
    } else {
      if (alignOnly) {
        throw new Error(
          `Cannot align ${poem.date} ${poem.title} without an existing matching audio file. `
          + "Run the regular TTS sync or tts:poem first."
        );
      }
      console.log(`Generating ${poem.date} ${poem.title}`);
      const audioBuffer = await fetchOpenAiAudio({ profile, text: speakableText });
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, audioBuffer);
    }

    console.log(`Aligning ${poem.date} ${poem.title}`);
    const timings = await alignWithMfa({ poem, mp3Path: outputPath });
    const timingsPath = timingsUrlToRepoPath(timingsUrl, root);
    await mkdir(path.dirname(timingsPath), { recursive: true });
    await writeFile(timingsPath, `${JSON.stringify(timings, null, 2)}\n`, "utf8");

    if (!audioMatches) {
      generated += 1;
    }

    nextManifest.poems[poem.date] = {
      audioUrl,
      timingsUrl,
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
      timingsVersion: timings.version,
      visibleWordCount: timings.visibleWordCount,
      matchedWordCount: timings.matchedWordCount,
      coverage: timings.coverage,
      generatedAt: new Date().toISOString()
    };
    activeAudioUrls.add(audioUrl);
    activeTimingUrls.add(timingsUrl);

    if (previousAudioUrl && previousAudioUrl !== audioUrl) {
      const removed = await removeSupersededAudioFile(previousAudioUrl);
      if (removed) {
        deleted += 1;
      }
    }
    if (previousTimingsUrl && previousTimingsUrl !== timingsUrl) {
      const removed = await removeSupersededTimingFile(previousTimingsUrl);
      if (removed) {
        deleted += 1;
      }
    }
  }

  if (dateFilter.size === 0) {
    deleted += await pruneUnusedAudioFiles(activeAudioUrls);
    deleted += await pruneUnusedTimingFiles(activeTimingUrls);
  } else {
    console.log("Skipped global stale asset pruning because sync was filtered by date.");
  }

  if (!dryRun) {
    await writeTtsManifest(nextManifest, root);
  }

  console.log("");
  console.log(`TTS sync complete for profile ${profile.renderProfile}.`);
  console.log(`Generated: ${generated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Deleted stale assets: ${deleted}`);
  if (alignOnly) {
    console.log("Mode: alignment only.");
  }
  if (dryRun) {
    console.log("Dry run only; no files were written.");
  }
}

await main();
