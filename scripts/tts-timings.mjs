import { createHash } from "node:crypto";
import path from "node:path";
import { repairMojibakePunctuation, speakablePoemLines } from "./tts-manifest.mjs";
import { integerToWords } from "./number-words.mjs";

export const TTS_TIMINGS_VERSION = 1;

function normalizeComparisonText(input) {
  return repairMojibakePunctuation(String(input || ""))
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
  const normalized = normalizeComparisonText(input)
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")
    .replace(/[^a-z0-9]+/gi, "");
  if (/^\d+$/.test(normalized)) {
    return integerToWords(Number(normalized));
  }
  return normalized;
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

function tokenizedPoemSections(poem) {
  return {
    titleTokens: tokenizeText(poem?.title || ""),
    authorTokens: tokenizeText(poem?.author || ""),
    translatorTokens: tokenizeText(poem?.translator || ""),
    bodyLineTokens: speakablePoemLines(poem?.poem || "").map((line) => tokenizeText(line))
  };
}

export function buildVisibleTokenSequence(poem) {
  const sections = tokenizedPoemSections(poem);
  const visibleTokens = [];

  for (const token of sections.titleTokens) {
    visibleTokens.push({
      index: visibleTokens.length,
      text: token.text,
      normalized: token.normalized,
      segment: "title"
    });
  }

  for (const token of sections.authorTokens) {
    visibleTokens.push({
      index: visibleTokens.length,
      text: token.text,
      normalized: token.normalized,
      segment: "author"
    });
  }

  for (const token of sections.translatorTokens) {
    visibleTokens.push({
      index: visibleTokens.length,
      text: token.text,
      normalized: token.normalized,
      segment: "translator"
    });
  }

  for (const lineTokens of sections.bodyLineTokens) {
    for (const token of lineTokens) {
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
  const sections = tokenizedPoemSections(poem);
  const visibleTokens = [];
  const titleIndexes = [];
  const authorIndexes = [];
  const translatorIndexes = [];
  const bodyLineIndexes = [];
  const spokenTokens = [];

  for (const token of sections.titleTokens) {
    titleIndexes.push(visibleTokens.length);
    visibleTokens.push({
      index: visibleTokens.length,
      text: token.text,
      normalized: token.normalized,
      segment: "title"
    });
  }

  for (const token of sections.authorTokens) {
    authorIndexes.push(visibleTokens.length);
    visibleTokens.push({
      index: visibleTokens.length,
      text: token.text,
      normalized: token.normalized,
      segment: "author"
    });
  }

  for (const token of sections.translatorTokens) {
    translatorIndexes.push(visibleTokens.length);
    visibleTokens.push({
      index: visibleTokens.length,
      text: token.text,
      normalized: token.normalized,
      segment: "translator"
    });
  }

  for (const lineTokens of sections.bodyLineTokens) {
    const lineIndexes = [];
    for (const token of lineTokens) {
      lineIndexes.push(visibleTokens.length);
      visibleTokens.push({
        index: visibleTokens.length,
        text: token.text,
        normalized: token.normalized,
        segment: "body"
      });
    }
    bodyLineIndexes.push(lineIndexes);
  }

  for (const [index, token] of sections.titleTokens.entries()) {
    spokenTokens.push({
      text: token.text,
      normalized: token.normalized,
      visibleIndexes: [titleIndexes[index]]
    });
  }

  if (sections.authorTokens.length > 0) {
    for (const token of tokenizeText("by")) {
      spokenTokens.push({
        text: token.text,
        normalized: token.normalized,
        visibleIndexes: []
      });
    }
    for (const [index, token] of sections.authorTokens.entries()) {
      spokenTokens.push({
        text: token.text,
        normalized: token.normalized,
        visibleIndexes: [authorIndexes[index]]
      });
    }
  }

  if (sections.translatorTokens.length > 0) {
    for (const token of tokenizeText("translated by")) {
      spokenTokens.push({
        text: token.text,
        normalized: token.normalized,
        visibleIndexes: []
      });
    }
    for (const [index, token] of sections.translatorTokens.entries()) {
      spokenTokens.push({
        text: token.text,
        normalized: token.normalized,
        visibleIndexes: [translatorIndexes[index]]
      });
    }
  }

  for (const [lineIndex, lineTokens] of sections.bodyLineTokens.entries()) {
    for (const [tokenIndex, token] of lineTokens.entries()) {
      spokenTokens.push({
        text: token.text,
        normalized: token.normalized,
        visibleIndexes: [bodyLineIndexes[lineIndex][tokenIndex]]
      });
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

function estimateStandaloneRunSpan(tokens) {
  const countBased = tokens.length * 0.18;
  const weightBased = tokens.reduce((sum, token) => sum + (tokenWeight(token) * 0.06), 0);
  return Math.min(2.4, Math.max(0.24, Math.max(countBased, weightBased)));
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

function pushVisibleWordEntries(words, visibleTokens, spokenToken, start, end) {
  const visibleIndexes = Array.isArray(spokenToken?.visibleIndexes) ? spokenToken.visibleIndexes : [];
  for (const visibleIndex of visibleIndexes) {
    if (!Number.isInteger(visibleIndex)) {
      continue;
    }
    const visibleToken = visibleTokens[visibleIndex];
    words.push({
      tokenIndex: visibleIndex,
      text: visibleToken?.text || spokenToken.text,
      start,
      end,
      segment: visibleToken?.segment || ""
    });
  }
}

function estimatePendingRunSpan(pendingTokens, availableSpan) {
  const estimatedSpan = estimateStandaloneRunSpan(pendingTokens);
  return Math.max(
    0.24,
    Math.min(
      Math.max(availableSpan, 0.24),
      estimatedSpan
    )
  );
}

function flushPendingSpokenRun(words, visibleTokens, pendingTokens, nextStart, previousEnd = Number.NaN) {
  if (!Array.isArray(pendingTokens) || pendingTokens.length === 0 || !Number.isFinite(nextStart)) {
    return;
  }

  const baseStart = Number.isFinite(previousEnd) ? previousEnd : 0.05;
  const availableSpan = Math.max(0, nextStart - baseStart);
  const minimumSpan = Math.max(0.04 * pendingTokens.length, 0.04);

  let start = baseStart;
  let end = nextStart;

  if (!Number.isFinite(previousEnd)) {
    const runSpan = estimatePendingRunSpan(pendingTokens, availableSpan);
    end = Math.min(nextStart, baseStart + runSpan);
  } else {
    const runSpan = Math.max(
      estimatePendingRunSpan(pendingTokens, availableSpan),
      availableSpan * 0.82
    );
    start = Math.max(baseStart, nextStart - runSpan);
  }

  if ((end - start) < minimumSpan) {
    if (Number.isFinite(previousEnd)) {
      start = Math.max(baseStart, nextStart - minimumSpan);
      end = nextStart;
    } else {
      start = baseStart;
      end = Math.min(nextStart, baseStart + minimumSpan);
    }
  }

  const slices = splitRunAcrossTokens(pendingTokens, start, end);
  for (const slice of slices) {
    pushVisibleWordEntries(words, visibleTokens, slice.token, slice.start, slice.end);
  }
}

function flushTrailingSpokenRun(words, visibleTokens, pendingTokens, previousEnd = Number.NaN) {
  if (!Array.isArray(pendingTokens) || pendingTokens.length === 0) {
    return;
  }

  const start = Number.isFinite(previousEnd) ? previousEnd : 0.05;
  const end = start + estimateStandaloneRunSpan(pendingTokens);
  const slices = splitRunAcrossTokens(pendingTokens, start, end);
  for (const slice of slices) {
    pushVisibleWordEntries(words, visibleTokens, slice.token, slice.start, slice.end);
  }
}

function fingerprintIntervals(intervals) {
  return createHash("sha256").update(JSON.stringify(intervals)).digest("hex").slice(0, 16);
}

function findNextMatchIndex(items, startIndex, targetNormalized, window = 8) {
  const limit = Math.min(items.length, startIndex + window + 1);
  for (let index = startIndex + 1; index < limit; index += 1) {
    if (items[index]?.normalized === targetNormalized) {
      return index;
    }
  }
  return -1;
}

export function alignVisibleWordTimings(poem, intervals) {
  const { visibleTokens, spokenTokens } = buildSpokenTokenSequence(poem);
  const spokenIntervals = intervals.filter((interval) => interval.normalized);
  const words = [];
  let spokenIndex = 0;
  let intervalIndex = 0;
  let lastConsumedEnd = Number.NaN;
  let pendingSpokenTokens = [];

  while (spokenIndex < spokenTokens.length && intervalIndex < spokenIntervals.length) {
    const spokenToken = spokenTokens[spokenIndex];
    const interval = spokenIntervals[intervalIndex];

    if (spokenToken.normalized === interval.normalized) {
      flushPendingSpokenRun(words, visibleTokens, pendingSpokenTokens, interval.start, lastConsumedEnd);
      pendingSpokenTokens = [];
      pushVisibleWordEntries(words, visibleTokens, spokenToken, interval.start, interval.end);
      lastConsumedEnd = interval.end;
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
      flushPendingSpokenRun(words, visibleTokens, pendingSpokenTokens, interval.start, lastConsumedEnd);
      pendingSpokenTokens = [];
      const slices = splitRunAcrossTokens(run, interval.start, interval.end);
      for (const slice of slices) {
        pushVisibleWordEntries(words, visibleTokens, slice.token, slice.start, slice.end);
      }
      lastConsumedEnd = interval.end;
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
      flushPendingSpokenRun(words, visibleTokens, pendingSpokenTokens, spokenIntervals[intervalIndex].start, lastConsumedEnd);
      pendingSpokenTokens = [];
      pushVisibleWordEntries(
        words,
        visibleTokens,
        spokenToken,
        spokenIntervals[intervalIndex].start,
        spokenIntervals[intervalIndex + mergedIntervalLength - 1].end
      );
      lastConsumedEnd = spokenIntervals[intervalIndex + mergedIntervalLength - 1].end;
      spokenIndex += 1;
      intervalIndex += mergedIntervalLength;
      continue;
    }

    const nextSpokenMatch = findNextMatchIndex(spokenTokens, spokenIndex, interval.normalized);
    const nextIntervalMatch = findNextMatchIndex(spokenIntervals, intervalIndex, spokenToken.normalized);

    if (nextSpokenMatch >= 0 && (nextIntervalMatch < 0 || (nextSpokenMatch - spokenIndex) <= (nextIntervalMatch - intervalIndex))) {
      pendingSpokenTokens.push(...spokenTokens.slice(spokenIndex, nextSpokenMatch));
      spokenIndex = nextSpokenMatch;
      continue;
    }

    if (nextIntervalMatch >= 0) {
      intervalIndex = nextIntervalMatch;
      continue;
    }

    pendingSpokenTokens.push(spokenToken);
    spokenIndex += 1;
    intervalIndex += 1;
  }

  flushTrailingSpokenRun(
    words,
    visibleTokens,
    pendingSpokenTokens.concat(spokenTokens.slice(spokenIndex)),
    lastConsumedEnd
  );

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
