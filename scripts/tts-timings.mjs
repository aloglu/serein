import { createHash } from "node:crypto";
import path from "node:path";
import { normalizeNewlines } from "./tts-manifest.mjs";
import { speakablePoetryLineDirective } from "./poetry-line.mjs";

export const TTS_TIMINGS_VERSION = 1;

function normalizeComparisonText(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeTokenText(input) {
  return normalizeComparisonText(input)
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")
    .replace(/[^a-z0-9]+/gi, "");
}

function tokenizeText(text) {
  const tokens = [];
  for (const match of String(text || "").matchAll(/\S+/g)) {
    const value = match[0];
    const normalized = normalizeTokenText(value);
    if (!normalized) {
      continue;
    }
    tokens.push({
      text: value,
      normalized
    });
  }
  return tokens;
}

function speakableBodyLines(poem) {
  return normalizeNewlines(poem?.poem || "")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return "";
      }
      if (trimmed.startsWith("::line")) {
        return speakablePoetryLineDirective(trimmed) ?? trimmed.replace(/^::line\s*/, "");
      }
      return line;
    })
    .filter((line) => String(line || "").trim());
}

export function buildVisibleTokenSequence(poem) {
  const visibleTokens = [];

  for (const token of tokenizeText(poem?.title || "")) {
    visibleTokens.push({
      index: visibleTokens.length,
      text: token.text,
      normalized: token.normalized,
      segment: "title"
    });
  }

  for (const token of tokenizeText(poem?.author || "")) {
    visibleTokens.push({
      index: visibleTokens.length,
      text: token.text,
      normalized: token.normalized,
      segment: "author"
    });
  }

  for (const token of tokenizeText(poem?.translator || "")) {
    visibleTokens.push({
      index: visibleTokens.length,
      text: token.text,
      normalized: token.normalized,
      segment: "translator"
    });
  }

  for (const line of speakableBodyLines(poem)) {
    for (const token of tokenizeText(line)) {
      visibleTokens.push({
        index: visibleTokens.length,
        text: token.text,
        normalized: token.normalized,
        segment: "body"
      });
    }
  }

  return visibleTokens;
}

export function buildSpokenTokenSequence(poem) {
  const visibleTokens = buildVisibleTokenSequence(poem);
  const spokenTokens = [];
  let visibleIndex = 0;

  for (const token of tokenizeText(poem?.title || "")) {
    spokenTokens.push({
      text: token.text,
      normalized: token.normalized,
      visibleIndex: visibleIndex
    });
    visibleIndex += 1;
  }

  if (String(poem?.author || "").trim()) {
    for (const token of tokenizeText("by")) {
      spokenTokens.push({
        text: token.text,
        normalized: token.normalized,
        visibleIndex: null
      });
    }
    for (const token of tokenizeText(poem.author)) {
      spokenTokens.push({
        text: token.text,
        normalized: token.normalized,
        visibleIndex
      });
      visibleIndex += 1;
    }
  }

  if (String(poem?.translator || "").trim()) {
    for (const token of tokenizeText("translated by")) {
      spokenTokens.push({
        text: token.text,
        normalized: token.normalized,
        visibleIndex: null
      });
    }
    for (const token of tokenizeText(poem.translator)) {
      spokenTokens.push({
        text: token.text,
        normalized: token.normalized,
        visibleIndex
      });
      visibleIndex += 1;
    }
  }

  for (const line of speakableBodyLines(poem)) {
    for (const token of tokenizeText(line)) {
      spokenTokens.push({
        text: token.text,
        normalized: token.normalized,
        visibleIndex
      });
      visibleIndex += 1;
    }
  }

  return {
    visibleTokens,
    spokenTokens
  };
}

export function buildManagedTimingsUrl({ poem, assetKey }) {
  const parts = String(poem?.date || "").split("-");
  if (parts.length !== 3) {
    throw new Error(`Invalid poem date '${poem?.date || ""}' while building TTS timings URL.`);
  }

  const basename = String(poem?.filename || "").replace(/\.[^.]+$/, "");
  if (!basename) {
    throw new Error(`Missing poem filename for '${poem?.date || ""}'.`);
  }

  return `/assets/tts/timings/${parts[0]}/${parts[1]}/${basename}.${assetKey}.json`;
}

export function timingsUrlToRepoPath(timingsUrl, root = process.cwd()) {
  const normalized = String(timingsUrl || "").trim();
  if (!normalized.startsWith("/assets/tts/")) {
    return "";
  }
  return path.join(root, ...normalized.slice(1).split("/"));
}

export function parseTextGridWordIntervals(textGridText) {
  const source = String(textGridText || "");
  const intervals = [];
  const tierPattern = /item \[\d+\]:\s+class = "IntervalTier"\s+name = "([^"]+)"/g;
  let tierMatch = null;
  let wordTierStart = -1;
  let wordTierEnd = source.length;

  while ((tierMatch = tierPattern.exec(source))) {
    if (tierMatch[1] !== "words") {
      continue;
    }
    wordTierStart = tierMatch.index;
    const nextMatch = tierPattern.exec(source);
    wordTierEnd = nextMatch ? nextMatch.index : source.length;
    break;
  }

  if (wordTierStart < 0) {
    return [];
  }

  const tierText = source.slice(wordTierStart, wordTierEnd);
  const intervalPattern = /intervals \[\d+\]:\s+xmin = ([0-9.]+)\s+xmax = ([0-9.]+)\s+text = "([^"]*)"/g;
  let match = null;
  while ((match = intervalPattern.exec(tierText))) {
    const text = match[3];
    const normalized = normalizeTokenText(text);
    if (!normalized) {
      continue;
    }
    intervals.push({
      word: text,
      normalized,
      start: Number(match[1]),
      end: Number(match[2])
    });
  }

  return intervals;
}

function tokenWeight(token) {
  return Math.max(1, String(token?.text || "").length);
}

function splitRunAcrossTokens(tokens, start, end) {
  const totalWeight = tokens.reduce((sum, token) => sum + tokenWeight(token), 0);
  const span = Math.max(0, end - start);
  const slices = [];
  let cursor = start;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const fraction = tokenWeight(token) / totalWeight;
    const sliceEnd = index === tokens.length - 1 ? end : (cursor + (span * fraction));
    slices.push({
      token,
      start: cursor,
      end: sliceEnd
    });
    cursor = sliceEnd;
  }

  return slices;
}

function fingerprintIntervals(intervals) {
  return createHash("sha256").update(JSON.stringify(intervals)).digest("hex").slice(0, 16);
}

export function alignVisibleWordTimings(poem, intervals) {
  const { visibleTokens, spokenTokens } = buildSpokenTokenSequence(poem);
  const spokenIntervals = intervals.filter((interval) => interval.normalized);
  const words = [];
  let spokenIndex = 0;
  let intervalIndex = 0;

  while (spokenIndex < spokenTokens.length && intervalIndex < spokenIntervals.length) {
    const spokenToken = spokenTokens[spokenIndex];
    const interval = spokenIntervals[intervalIndex];

    if (spokenToken.normalized === interval.normalized) {
      if (Number.isInteger(spokenToken.visibleIndex)) {
        words.push({
          tokenIndex: spokenToken.visibleIndex,
          text: visibleTokens[spokenToken.visibleIndex]?.text || spokenToken.text,
          start: interval.start,
          end: interval.end,
          segment: visibleTokens[spokenToken.visibleIndex]?.segment || ""
        });
      }
      spokenIndex += 1;
      intervalIndex += 1;
      continue;
    }

    let mergedSpokenLength = 0;
    for (let runLength = 2; runLength <= 4 && spokenIndex + runLength <= spokenTokens.length; runLength += 1) {
      const run = spokenTokens.slice(spokenIndex, spokenIndex + runLength);
      if (run.map((entry) => entry.normalized).join("") === interval.normalized) {
        mergedSpokenLength = runLength;
        break;
      }
    }

    if (mergedSpokenLength > 0) {
      const run = spokenTokens.slice(spokenIndex, spokenIndex + mergedSpokenLength);
      const slices = splitRunAcrossTokens(run, interval.start, interval.end);
      for (const slice of slices) {
        if (!Number.isInteger(slice.token.visibleIndex)) {
          continue;
        }
        const visibleToken = visibleTokens[slice.token.visibleIndex];
        words.push({
          tokenIndex: slice.token.visibleIndex,
          text: visibleToken?.text || slice.token.text,
          start: slice.start,
          end: slice.end,
          segment: visibleToken?.segment || ""
        });
      }
      spokenIndex += mergedSpokenLength;
      intervalIndex += 1;
      continue;
    }

    let mergedIntervalLength = 0;
    for (let runLength = 2; runLength <= 4 && intervalIndex + runLength <= spokenIntervals.length; runLength += 1) {
      const run = spokenIntervals.slice(intervalIndex, intervalIndex + runLength);
      if (run.map((entry) => entry.normalized).join("") === spokenToken.normalized) {
        mergedIntervalLength = runLength;
        break;
      }
    }

    if (mergedIntervalLength > 0) {
      if (Number.isInteger(spokenToken.visibleIndex)) {
        const visibleToken = visibleTokens[spokenToken.visibleIndex];
        words.push({
          tokenIndex: spokenToken.visibleIndex,
          text: visibleToken?.text || spokenToken.text,
          start: spokenIntervals[intervalIndex].start,
          end: spokenIntervals[intervalIndex + mergedIntervalLength - 1].end,
          segment: visibleToken?.segment || ""
        });
      }
      spokenIndex += 1;
      intervalIndex += mergedIntervalLength;
      continue;
    }

    spokenIndex += 1;
  }

  const sortedWords = words.sort((left, right) => left.tokenIndex - right.tokenIndex);
  return {
    version: TTS_TIMINGS_VERSION,
    visibleWordCount: visibleTokens.length,
    matchedWordCount: sortedWords.length,
    coverage: visibleTokens.length ? Number((sortedWords.length / visibleTokens.length).toFixed(4)) : 0,
    intervalFingerprint: fingerprintIntervals(intervals),
    words: sortedWords
  };
}
