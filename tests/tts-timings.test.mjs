import assert from "node:assert/strict";
import test from "node:test";
import { speakablePoemScript } from "../scripts/tts-manifest.mjs";
import { alignVisibleWordTimings, normalizeTokenText } from "../scripts/tts-timings.mjs";

test("normalizeTokenText repairs mojibake punctuation markers", () => {
  assert.equal(normalizeTokenText("â€™"), "");
  assert.equal(normalizeTokenText("The Strangersâ€™ Case"), "thestrangerscase");
  assert.equal(normalizeTokenText("[â€¦]"), "");
  assert.equal(normalizeTokenText("â€”"), "");
});

test("normalizeTokenText normalizes digit tokens to spoken word forms", () => {
  assert.equal(normalizeTokenText("15."), "fifteen");
  assert.equal(normalizeTokenText("85"), "eightyfive");
  assert.equal(normalizeTokenText("100"), "onehundred");
});

test("alignVisibleWordTimings matches a numeric title against spoken word intervals", () => {
  const poem = {
    title: "15.",
    author: "bell hooks",
    translator: "",
    poem: "hold on"
  };
  const timings = alignVisibleWordTimings(poem, [
    { word: "fifteen", normalized: normalizeTokenText("fifteen"), start: 0, end: 0.3 },
    { word: "by", normalized: normalizeTokenText("by"), start: 0.3, end: 0.4 },
    { word: "bell", normalized: normalizeTokenText("bell"), start: 0.4, end: 0.6 },
    { word: "hooks", normalized: normalizeTokenText("hooks"), start: 0.6, end: 0.8 },
    { word: "hold", normalized: normalizeTokenText("hold"), start: 0.8, end: 1.0 },
    { word: "on", normalized: normalizeTokenText("on"), start: 1.0, end: 1.2 }
  ]);

  assert.equal(timings.matchedWordCount, 5);
  assert.deepEqual(timings.words.map((word) => word.text), ["15.", "bell", "hooks", "hold", "on"]);
});

test("speakablePoemScript verbalizes standalone number titles", () => {
  const poem = {
    title: "15.",
    author: "bell hooks",
    translator: "",
    poem: "hold on"
  };

  assert.equal(
    speakablePoemScript(poem),
    "fifteen., by bell hooks.\n\nhold on"
  );
});

test("alignVisibleWordTimings ignores repaired bracketed ellipsis markers", () => {
  const poem = {
    title: "The Strangersâ€™ Case",
    author: "William Shakespeare",
    translator: "",
    poem: "Would feed on one another.\n[â€¦]\nSay now the king,"
  };
  const timings = alignVisibleWordTimings(poem, [
    { word: "the", normalized: normalizeTokenText("the"), start: 0, end: 0.1 },
    { word: "strangers", normalized: normalizeTokenText("strangers"), start: 0.1, end: 0.3 },
    { word: "case", normalized: normalizeTokenText("case"), start: 0.3, end: 0.5 },
    { word: "by", normalized: normalizeTokenText("by"), start: 0.5, end: 0.6 },
    { word: "william", normalized: normalizeTokenText("william"), start: 0.6, end: 0.8 },
    { word: "shakespeare", normalized: normalizeTokenText("shakespeare"), start: 0.8, end: 1.1 },
    { word: "would", normalized: normalizeTokenText("would"), start: 1.1, end: 1.3 },
    { word: "feed", normalized: normalizeTokenText("feed"), start: 1.3, end: 1.5 },
    { word: "on", normalized: normalizeTokenText("on"), start: 1.5, end: 1.6 },
    { word: "one", normalized: normalizeTokenText("one"), start: 1.6, end: 1.8 },
    { word: "another", normalized: normalizeTokenText("another"), start: 1.8, end: 2.0 },
    { word: "say", normalized: normalizeTokenText("say"), start: 2.0, end: 2.2 },
    { word: "now", normalized: normalizeTokenText("now"), start: 2.2, end: 2.4 },
    { word: "the", normalized: normalizeTokenText("the"), start: 2.4, end: 2.5 },
    { word: "king", normalized: normalizeTokenText("king"), start: 2.5, end: 2.7 }
  ]);

  assert.deepEqual(
    timings.words.slice(-4).map((word) => word.text),
    ["Say", "now", "the", "king,"]
  );
});

test("alignVisibleWordTimings can recover after a stray MFA interval", () => {
  const poem = {
    title: "The StrangersÃ¢â‚¬â„¢ Case",
    author: "William Shakespeare",
    translator: "",
    poem: "Would feed on one another.\n[Ã¢â‚¬Â¦]\nSay now the king,"
  };
  const timings = alignVisibleWordTimings(poem, [
    { word: "the", normalized: normalizeTokenText("the"), start: 0, end: 0.1 },
    { word: "strangers", normalized: normalizeTokenText("strangers"), start: 0.1, end: 0.3 },
    { word: "case", normalized: normalizeTokenText("case"), start: 0.3, end: 0.5 },
    { word: "by", normalized: normalizeTokenText("by"), start: 0.5, end: 0.6 },
    { word: "william", normalized: normalizeTokenText("william"), start: 0.6, end: 0.8 },
    { word: "shakespeare", normalized: normalizeTokenText("shakespeare"), start: 0.8, end: 1.1 },
    { word: "would", normalized: normalizeTokenText("would"), start: 1.1, end: 1.3 },
    { word: "feed", normalized: normalizeTokenText("feed"), start: 1.3, end: 1.5 },
    { word: "on", normalized: normalizeTokenText("on"), start: 1.5, end: 1.6 },
    { word: "one", normalized: normalizeTokenText("one"), start: 1.6, end: 1.8 },
    { word: "another", normalized: normalizeTokenText("another"), start: 1.8, end: 2.0 },
    { word: "murmur", normalized: normalizeTokenText("murmur"), start: 2.0, end: 2.1 },
    { word: "say", normalized: normalizeTokenText("say"), start: 2.1, end: 2.3 },
    { word: "now", normalized: normalizeTokenText("now"), start: 2.3, end: 2.5 },
    { word: "the", normalized: normalizeTokenText("the"), start: 2.5, end: 2.6 },
    { word: "king", normalized: normalizeTokenText("king"), start: 2.6, end: 2.8 }
  ]);

  assert.deepEqual(
    timings.words.slice(-4).map((word) => word.text),
    ["Say", "now", "the", "king,"]
  );
});
