const WINDOWS_1252_REVERSE = new Map([
  ["€", 0x80],
  ["‚", 0x82],
  ["ƒ", 0x83],
  ["„", 0x84],
  ["…", 0x85],
  ["†", 0x86],
  ["‡", 0x87],
  ["ˆ", 0x88],
  ["‰", 0x89],
  ["Š", 0x8a],
  ["‹", 0x8b],
  ["Œ", 0x8c],
  ["Ž", 0x8e],
  ["‘", 0x91],
  ["’", 0x92],
  ["“", 0x93],
  ["”", 0x94],
  ["•", 0x95],
  ["–", 0x96],
  ["—", 0x97],
  ["˜", 0x98],
  ["™", 0x99],
  ["š", 0x9a],
  ["›", 0x9b],
  ["œ", 0x9c],
  ["ž", 0x9e],
  ["Ÿ", 0x9f]
]);

const MOJIBAKE_RE = /(?:Ã.|Â.|â.)/;

export function repairMojibakeText(input) {
  const source = String(input || "");
  if (!MOJIBAKE_RE.test(source)) {
    return source;
  }

  const bytes = [];
  for (const char of source) {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint !== "number") {
      return source;
    }
    if (codePoint <= 0xff) {
      bytes.push(codePoint);
      continue;
    }

    const byte = WINDOWS_1252_REVERSE.get(char);
    if (typeof byte !== "number") {
      return source;
    }
    bytes.push(byte);
  }

  try {
    const repaired = Buffer.from(bytes).toString("utf8");
    if (!repaired || repaired.includes("\uFFFD")) {
      return source;
    }
    return repaired.replaceAll("\u00c2\u00a0", "\u00a0");
  } catch {
    return source;
  }
}
