const SMALL_NUMBER_WORDS = new Map([
  [0, "zero"],
  [1, "one"],
  [2, "two"],
  [3, "three"],
  [4, "four"],
  [5, "five"],
  [6, "six"],
  [7, "seven"],
  [8, "eight"],
  [9, "nine"],
  [10, "ten"],
  [11, "eleven"],
  [12, "twelve"],
  [13, "thirteen"],
  [14, "fourteen"],
  [15, "fifteen"],
  [16, "sixteen"],
  [17, "seventeen"],
  [18, "eighteen"],
  [19, "nineteen"]
]);

const TENS_NUMBER_WORDS = new Map([
  [20, "twenty"],
  [30, "thirty"],
  [40, "forty"],
  [50, "fifty"],
  [60, "sixty"],
  [70, "seventy"],
  [80, "eighty"],
  [90, "ninety"]
]);

export function integerToWords(value) {
  if (!Number.isInteger(value) || value < 0) {
    return "";
  }
  if (SMALL_NUMBER_WORDS.has(value)) {
    return SMALL_NUMBER_WORDS.get(value);
  }
  if (TENS_NUMBER_WORDS.has(value)) {
    return TENS_NUMBER_WORDS.get(value);
  }
  if (value < 100) {
    const tens = Math.floor(value / 10) * 10;
    const ones = value % 10;
    return `${TENS_NUMBER_WORDS.get(tens)}${SMALL_NUMBER_WORDS.get(ones)}`;
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const remainder = value % 100;
    return `${SMALL_NUMBER_WORDS.get(hundreds)}hundred${remainder ? integerToWords(remainder) : ""}`;
  }
  if (value < 10000) {
    const thousands = Math.floor(value / 1000);
    const remainder = value % 1000;
    return `${SMALL_NUMBER_WORDS.get(thousands)}thousand${remainder ? integerToWords(remainder) : ""}`;
  }
  return String(value);
}

export function verbalizeStandaloneNumbers(input) {
  return String(input || "").replace(/\b(\d+)([.,;:!?"]*)/g, (match, digits, suffix) => {
    if (!/^\d+$/.test(digits)) {
      return match;
    }
    const words = integerToWords(Number(digits));
    if (!words) {
      return match;
    }
    return `${words}${suffix || ""}`;
  });
}
