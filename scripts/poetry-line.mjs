function parsePoetryTextAlignOverride(raw) {
  const source = String(raw || "");
  const match = source.match(/^\s*(left|center|right)\s*:\s*([\s\S]*)$/i);
  if (!match) {
    return { textAlign: null, text: source };
  }
  return {
    textAlign: match[1].toLowerCase(),
    text: match[2]
  };
}

function parsePoetrySpacerWidth(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return "0.6rem";
  }
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    return `${value}ch`;
  }
  if (/^\d+(?:\.\d+)?(?:px|rem|em|ch|vw|vh|%)$/i.test(value)) {
    return value.toLowerCase();
  }
  return null;
}

export function parsePoetryLineDirective(line) {
  const cleanedLine = String(line || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\uFF5C/g, "|")
    .replace(/[\u2223\u2758\u00A6]/g, "|")
    .replace(/[\u301C\uFF5E\u223C\u2053\u223F]/g, "~");
  const match = cleanedLine.match(/^\s*::line\b\s*(.+)$/);
  if (!match) {
    return null;
  }

  const source = match[1];
  const spacerOnly = source.match(/^\s*(?:\|\s*)?~\s*([^|]*?)(?:\s*\|)?\s*$/);
  if (spacerOnly) {
    const spacerWidth = parsePoetrySpacerWidth(spacerOnly[1].replace(/\\\|/g, "|"));
    if (!spacerWidth) {
      return null;
    }
    return [{ align: "~", spacerWidth }];
  }

  const segments = [];
  const tokenPattern = /\|\s*([<^>~])\s*((?:\\\||[^|])*)\|/g;
  let lastIndex = 0;
  let hasDirectiveToken = false;

  for (const token of source.matchAll(tokenPattern)) {
    hasDirectiveToken = true;
    const tokenIndex = token.index ?? 0;
    if (source.slice(lastIndex, tokenIndex).trim()) {
      return null;
    }

    const align = token[1];
    const text = token[2].replace(/\\\|/g, "|");
    if (align === "~") {
      const spacerWidth = parsePoetrySpacerWidth(text);
      if (!spacerWidth) {
        return null;
      }
      segments.push({
        align,
        spacerWidth
      });
      lastIndex = tokenIndex + token[0].length;
      continue;
    }

    const { textAlign, text: parsedText } = parsePoetryTextAlignOverride(text);
    segments.push({
      align,
      text: parsedText,
      textAlign
    });
    lastIndex = tokenIndex + token[0].length;
  }

  const trailing = source.slice(lastIndex);
  if (trailing.trim()) {
    if (!hasDirectiveToken) {
      return null;
    }
    if (trailing.includes("|")) {
      return null;
    }
    segments.push({
      align: "<",
      text: trailing.trimStart(),
      textAlign: null
    });
  }

  if (segments.length === 0) {
    return null;
  }

  return segments;
}

export function speakablePoetryLineDirective(line) {
  const segments = parsePoetryLineDirective(line);
  if (!segments) {
    return null;
  }

  return segments
    .filter((segment) => segment.align !== "~")
    .map((segment) => String(segment.text || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}
