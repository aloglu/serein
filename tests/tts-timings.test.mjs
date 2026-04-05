import assert from "node:assert/strict";
import test from "node:test";
import { alignmentPoemScript, speakablePoemScript } from "../scripts/tts-manifest.mjs";
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

test("speakablePoemScript keeps an opening line even when it matches the title", () => {
  const poem = {
    title: "I have to tell you",
    author: "Dorothea Grossman",
    translator: "",
    poem: "I have to tell you,\nthere are times when\n"
  };

  assert.equal(
    speakablePoemScript(poem),
    "I have to tell you, by Dorothea Grossman.\n\nI have to tell you,\nthere are times when"
  );
});

test("speakablePoemScript strips inline markdown emphasis from poem lines", () => {
  const poem = {
    title: "The Uses of Sorrow",
    author: "Mary Oliver",
    translator: "",
    poem: "_(In my sleep I dreamed this poem)_\nSomeone I loved once gave me\n"
  };

  assert.equal(
    speakablePoemScript(poem),
    "The Uses of Sorrow, by Mary Oliver.\n\n(In my sleep I dreamed this poem)\nSomeone I loved once gave me"
  );
});

test("alignmentPoemScript strips token-edge punctuation for MFA input", () => {
  const poem = {
    title: "The Uses of Sorrow",
    author: "Mary Oliver",
    translator: "",
    poem: "_(In my sleep I dreamed this poem)_\nSomeone I loved once gave me"
  };

  assert.equal(
    alignmentPoemScript(poem),
    "The Uses of Sorrow by Mary Oliver\n\nIn my sleep I dreamed this poem\nSomeone I loved once gave me"
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

test("alignVisibleWordTimings handles a repeated opening line after the title", () => {
  const poem = {
    title: "I have to tell you",
    author: "Dorothea Grossman",
    translator: "",
    poem: "I have to tell you,\nthere are times when"
  };
  const timings = alignVisibleWordTimings(poem, [
    { word: "i", normalized: normalizeTokenText("i"), start: 0, end: 0.1 },
    { word: "have", normalized: normalizeTokenText("have"), start: 0.1, end: 0.3 },
    { word: "to", normalized: normalizeTokenText("to"), start: 0.3, end: 0.4 },
    { word: "tell", normalized: normalizeTokenText("tell"), start: 0.4, end: 0.6 },
    { word: "you", normalized: normalizeTokenText("you"), start: 0.6, end: 0.8 },
    { word: "by", normalized: normalizeTokenText("by"), start: 0.8, end: 0.9 },
    { word: "dorothea", normalized: normalizeTokenText("dorothea"), start: 0.9, end: 1.2 },
    { word: "grossman", normalized: normalizeTokenText("grossman"), start: 1.2, end: 1.6 },
    { word: "i", normalized: normalizeTokenText("i"), start: 1.6, end: 1.7 },
    { word: "have", normalized: normalizeTokenText("have"), start: 1.7, end: 1.9 },
    { word: "to", normalized: normalizeTokenText("to"), start: 1.9, end: 2.0 },
    { word: "tell", normalized: normalizeTokenText("tell"), start: 2.0, end: 2.2 },
    { word: "you", normalized: normalizeTokenText("you"), start: 2.2, end: 2.4 },
    { word: "there", normalized: normalizeTokenText("there"), start: 2.4, end: 2.7 },
    { word: "are", normalized: normalizeTokenText("are"), start: 2.7, end: 2.9 },
    { word: "times", normalized: normalizeTokenText("times"), start: 2.9, end: 3.2 },
    { word: "when", normalized: normalizeTokenText("when"), start: 3.2, end: 3.5 }
  ]);

  assert.equal(timings.matchedWordCount, 16);
  assert.deepEqual(
    timings.words.slice(0, 12).map((word) => word.text),
    [
      "I", "have", "to", "tell", "you",
      "Dorothea", "Grossman",
      "I", "have", "to", "tell", "you,"
    ]
  );
});

test("alignVisibleWordTimings backfills a missing leading title interval", () => {
  const poem = {
    title: "Ghosting",
    author: "Andrea Cohen",
    translator: "",
    poem: "How cavalier"
  };
  const timings = alignVisibleWordTimings(poem, [
    { word: "andrea", normalized: normalizeTokenText("andrea"), start: 1.45, end: 1.96 },
    { word: "cohen", normalized: normalizeTokenText("cohen"), start: 1.96, end: 2.51 },
    { word: "how", normalized: normalizeTokenText("how"), start: 3.31, end: 3.64 },
    { word: "cavalier", normalized: normalizeTokenText("cavalier"), start: 3.64, end: 4.41 }
  ]);

  assert.equal(timings.matchedWordCount, 5);
  assert.equal(timings.words[0].text, "Ghosting");
  assert.equal(timings.words[0].tokenIndex, 0);
  assert.ok(timings.words[0].start <= 0.2);
  assert.ok(timings.words[0].end <= timings.words[1].start);
});

test("alignVisibleWordTimings matches body text that begins with inline markdown emphasis", () => {
  const poem = {
    title: "The Uses of Sorrow",
    author: "Mary Oliver",
    translator: "",
    poem: "_(In my sleep I dreamed this poem)_\nSomeone I loved once gave me"
  };
  const timings = alignVisibleWordTimings(poem, [
    { word: "the", normalized: normalizeTokenText("the"), start: 0, end: 0.1 },
    { word: "uses", normalized: normalizeTokenText("uses"), start: 0.1, end: 0.3 },
    { word: "of", normalized: normalizeTokenText("of"), start: 0.3, end: 0.4 },
    { word: "sorrow", normalized: normalizeTokenText("sorrow"), start: 0.4, end: 0.7 },
    { word: "by", normalized: normalizeTokenText("by"), start: 0.7, end: 0.8 },
    { word: "mary", normalized: normalizeTokenText("mary"), start: 0.8, end: 1.0 },
    { word: "oliver", normalized: normalizeTokenText("oliver"), start: 1.0, end: 1.3 },
    { word: "in", normalized: normalizeTokenText("in"), start: 1.3, end: 1.4 },
    { word: "my", normalized: normalizeTokenText("my"), start: 1.4, end: 1.5 },
    { word: "sleep", normalized: normalizeTokenText("sleep"), start: 1.5, end: 1.7 },
    { word: "i", normalized: normalizeTokenText("i"), start: 1.7, end: 1.8 },
    { word: "dreamed", normalized: normalizeTokenText("dreamed"), start: 1.8, end: 2.1 },
    { word: "this", normalized: normalizeTokenText("this"), start: 2.1, end: 2.2 },
    { word: "poem", normalized: normalizeTokenText("poem"), start: 2.2, end: 2.4 },
    { word: "someone", normalized: normalizeTokenText("someone"), start: 2.4, end: 2.8 },
    { word: "i", normalized: normalizeTokenText("i"), start: 2.8, end: 2.9 },
    { word: "loved", normalized: normalizeTokenText("loved"), start: 2.9, end: 3.2 },
    { word: "once", normalized: normalizeTokenText("once"), start: 3.2, end: 3.4 },
    { word: "gave", normalized: normalizeTokenText("gave"), start: 3.4, end: 3.6 },
    { word: "me", normalized: normalizeTokenText("me"), start: 3.6, end: 3.8 }
  ]);

  assert.deepEqual(
    timings.words.slice(6).map((word) => word.text),
    ["(In", "my", "sleep", "I", "dreamed", "this", "poem)", "Someone", "I", "loved", "once", "gave", "me"]
  );
});

test("alignVisibleWordTimings backfills a missing leading body line before the first matched line", () => {
  const poem = {
    title: "The Uses of Sorrow",
    author: "Mary Oliver",
    translator: "",
    poem: "_(In my sleep I dreamed this poem)_\nSomeone I loved once gave me"
  };
  const timings = alignVisibleWordTimings(poem, [
    { word: "the", normalized: normalizeTokenText("the"), start: 0.06, end: 0.26 },
    { word: "uses", normalized: normalizeTokenText("uses"), start: 0.26, end: 1.07 },
    { word: "of", normalized: normalizeTokenText("of"), start: 1.07, end: 1.32 },
    { word: "sorrow", normalized: normalizeTokenText("sorrow"), start: 1.32, end: 2.07 },
    { word: "by", normalized: normalizeTokenText("by"), start: 2.07, end: 2.3 },
    { word: "mary", normalized: normalizeTokenText("mary"), start: 2.74, end: 3.2 },
    { word: "oliver", normalized: normalizeTokenText("oliver"), start: 3.2, end: 3.74 },
    { word: "someone", normalized: normalizeTokenText("someone"), start: 6.13, end: 6.52 },
    { word: "i", normalized: normalizeTokenText("i"), start: 6.52, end: 6.55 },
    { word: "loved", normalized: normalizeTokenText("loved"), start: 6.61, end: 6.94 },
    { word: "once", normalized: normalizeTokenText("once"), start: 6.94, end: 7.27 },
    { word: "gave", normalized: normalizeTokenText("gave"), start: 8.23, end: 8.37 },
    { word: "me", normalized: normalizeTokenText("me"), start: 8.37, end: 8.67 }
  ]);

  assert.deepEqual(
    timings.words.slice(0, 13).map((word) => word.text),
    ["The", "Uses", "of", "Sorrow", "Mary", "Oliver", "(In", "my", "sleep", "I", "dreamed", "this", "poem)"]
  );
  assert.equal(timings.words[6].tokenIndex, 6);
  assert.ok(timings.words[6].start > 4);
  assert.ok(timings.words[6].start < 5);
  assert.ok(timings.words[12].end >= 6);
  assert.ok(timings.words[12].end <= timings.words[13].start);
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

test("alignVisibleWordTimings backfills a trailing parenthetical run when alignment ends early", () => {
  const poem = {
    title: "",
    author: "",
    translator: "",
    poem: "though it may look like (Write it!) like disaster."
  };
  const timings = alignVisibleWordTimings(poem, [
    { word: "though", normalized: normalizeTokenText("though"), start: 0, end: 0.2 },
    { word: "it", normalized: normalizeTokenText("it"), start: 0.2, end: 0.32 },
    { word: "may", normalized: normalizeTokenText("may"), start: 0.32, end: 0.55 },
    { word: "look", normalized: normalizeTokenText("look"), start: 0.55, end: 0.88 },
    { word: "like", normalized: normalizeTokenText("like"), start: 0.88, end: 1.12 }
  ]);

  assert.equal(timings.matchedWordCount, 9);
  assert.deepEqual(
    timings.words.map((word) => word.text),
    ["though", "it", "may", "look", "like", "(Write", "it!)", "like", "disaster."]
  );
  assert.equal(timings.words[5].start, 1.12);
  assert.ok(timings.words[6].start >= timings.words[5].end);
  assert.ok(timings.words[8].end > timings.words[7].end);
});
