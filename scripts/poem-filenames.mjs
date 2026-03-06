const SMALL_NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen"
];

const TENS_NUMBER_WORDS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

const LARGE_NUMBER_WORDS = ["", "thousand", "million", "billion", "trillion"];

function integerBelowOneThousandToWords(value) {
  if (value < 20) {
    return SMALL_NUMBER_WORDS[value];
  }

  if (value < 100) {
    const tens = Math.floor(value / 10);
    const remainder = value % 10;
    return remainder ? `${TENS_NUMBER_WORDS[tens]}-${SMALL_NUMBER_WORDS[remainder]}` : TENS_NUMBER_WORDS[tens];
  }

  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  const prefix = `${SMALL_NUMBER_WORDS[hundreds]} hundred`;
  return remainder ? `${prefix} ${integerBelowOneThousandToWords(remainder)}` : prefix;
}

function integerToWords(value) {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const normalized = value.replace(/^0+(?=\d)/, "");
  if (normalized === "0") {
    return SMALL_NUMBER_WORDS[0];
  }

  let remainder = normalized;
  let chunkIndex = 0;
  const parts = [];

  while (remainder.length > 0) {
    const chunk = Number(remainder.slice(-3));
    remainder = remainder.slice(0, -3);

    if (chunk !== 0) {
      const words = integerBelowOneThousandToWords(chunk);
      const scale = LARGE_NUMBER_WORDS[chunkIndex];
      parts.unshift(scale ? `${words} ${scale}` : words);
    }

    chunkIndex += 1;
    if (chunkIndex >= LARGE_NUMBER_WORDS.length && remainder.length > 0) {
      return null;
    }
  }

  return parts.join(" ");
}

function normalizeTitleForFilename(input) {
  const raw = String(input || "").trim();
  const numericTitle = raw.replace(/[^\d]/g, "");
  if (numericTitle && raw.replace(/[\d\s.,!?;:'"()\-]/g, "") === "") {
    return integerToWords(numericTitle) || raw;
  }
  return raw;
}

export function slugifyForFilename(input) {
  return normalizeTitleForFilename(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function expectedPoemFilename(poem) {
  return expectedPoemFilenameWithExtension(poem, ".md");
}

export function expectedPoemFilenameWithExtension(poem, extension = ".md") {
  const date = String(poem?.date || "").trim();
  const titleSlug = slugifyForFilename(poem?.title || "");
  if (!date || !titleSlug) {
    return null;
  }
  const ext = String(extension || ".md");
  return `${date}-${titleSlug}${ext.startsWith(".") ? ext : `.${ext}`}`;
}
