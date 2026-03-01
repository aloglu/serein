import { mkdir, readdir, readFile, rm, writeFile, copyFile, cp } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { marked } from "marked";
import { expectedPoemFilename } from "./poem-filenames.mjs";

const root = process.cwd();
const poemsDir = path.join(root, "poems");
const distDir = path.join(root, "dist");
const templatesDir = path.join(root, "templates");
const assetsDir = path.join(root, "assets");
const siteUrl = String(process.env.SITE_URL || "").trim().replace(/\/+$/, "");
const INLINE_HIGHLIGHT_COLORS = new Set([
  "yellow",
  "light-yellow",
  "mimosa",
  "rose-gold",
  "violet",
  "strawberry",
  "red-brown",
  "ecru",
  "gray",
  "green",
  "mint-green",
  "pink",
  "blue"
]);

const watchMode = process.argv.includes("--watch");

function readArgValue(flagName) {
  const exactIndex = process.argv.indexOf(flagName);
  if (exactIndex >= 0) {
    return process.argv[exactIndex + 1] || "";
  }
  return "";
}

function parseAsOfDateArg() {
  const raw = String(readArgValue("--as-of") || "").trim();
  if (!raw) {
    return "";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid --as-of value '${raw}'. Expected YYYY-MM-DD.`);
  }
  return raw;
}

marked.setOptions({
  gfm: true,
  breaks: true
});

async function ensureDist() {
  const isTransientCleanupError = (error) => {
    const code = String(error?.code || "");
    return code === "EBUSY" || code === "EPERM" || code === "UNKNOWN";
  };

  await mkdir(distDir, { recursive: true });
  const entries = await readdir(distDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(distDir, entry.name);
    if (entry.name === "assets") {
      const assetsEntries = await readdir(fullPath, { withFileTypes: true }).catch(() => []);
      for (const assetEntry of assetsEntries) {
        try {
          await rm(path.join(fullPath, assetEntry.name), { recursive: true, force: true });
        } catch (error) {
          if (!isTransientCleanupError(error)) {
            throw error;
          }
        }
      }
      continue;
    }

    try {
      await rm(fullPath, { recursive: true, force: true });
    } catch (error) {
      if (!isTransientCleanupError(error)) {
        throw error;
      }
    }
  }
  await mkdir(path.join(distDir, "assets"), { recursive: true });
}

function htmlEscape(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function markdownStrip(input) {
  return String(input || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_`~>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTemplateTypography(templateText) {
  return String(templateText || "").replace(/([A-Za-z])'([A-Za-z])/g, "$1&rsquo;$2");
}

async function readTemplate(name) {
  const fullPath = path.join(templatesDir, name);
  const text = await readFile(fullPath, "utf8");
  const normalized = normalizeTemplateTypography(text);
  if (normalized !== text) {
    await writeFile(fullPath, normalized, "utf8");
    console.log(`Auto-fixed typography in templates/${name}`);
  }
  return normalized;
}

function normalizeNewlines(input) {
  return String(input || "").replace(/\r\n/g, "\n");
}

function stripWrappingQuotes(input) {
  const raw = String(input || "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parsePoemMarkdownFile(rawContent, filename) {
  const source = normalizeNewlines(rawContent);
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new Error(`Missing frontmatter in ${filename}. Expected file to start with '---'.`);
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }
  if (endIndex < 0) {
    throw new Error(`Unterminated frontmatter in ${filename}. Missing closing '---'.`);
  }

  const poem = {
    title: "",
    author: "",
    publication: "",
    date: "",
    source: "",
    poem: ""
  };

  const metaLines = lines.slice(1, endIndex);

  for (const line of metaLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) {
      continue;
    }

    const key = kv[1].toLowerCase();
    const value = kv[2];

    if (key in poem && key !== "poem") {
      poem[key] = stripWrappingQuotes(value);
    }
  }

  poem.poem = lines.slice(endIndex + 1).join("\n").replace(/^\n+/, "");
  return poem;
}

function parseDateParts(yyyyMmDd) {
  const match = String(yyyyMmDd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return {
    year: match[1],
    month: match[2],
    day: match[3]
  };
}

function monthFolderName(monthNumber) {
  const month = Number(monthNumber);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return "";
  }
  const label = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, month - 1, 1))
  );
  return `${String(month).padStart(2, "0")}-${label}`;
}

function expectedPoemSubdirForDate(yyyyMmDd) {
  const parts = parseDateParts(yyyyMmDd);
  if (!parts) {
    return null;
  }
  const monthFolder = monthFolderName(parts.month);
  if (!monthFolder) {
    return null;
  }
  return path.join(parts.year, monthFolder);
}

function yyyyMmDdInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function toRoutePath(yyyyMmDd) {
  const parts = parseDateParts(yyyyMmDd);
  if (!parts) {
    return null;
  }
  return `/${parts.year}/${parts.month}/${parts.day}`;
}

function depthForRoute(routePath) {
  if (routePath === "/") {
    return 0;
  }
  return routePath.split("/").filter(Boolean).length;
}

function relativePrefix(routePath) {
  const depth = depthForRoute(routePath);
  if (depth === 0) {
    return "./";
  }
  return "../".repeat(depth);
}

function assetPath(routePath) {
  return `${relativePrefix(routePath)}assets/styles.css`;
}

function scriptPath(routePath) {
  return `${relativePrefix(routePath)}assets/app.js`;
}

function manifestPath(routePath) {
  return `${relativePrefix(routePath)}site.webmanifest`;
}

function favicon32Path(routePath) {
  return `${relativePrefix(routePath)}assets/branding/icon-circle-32.png`;
}

function favicon512Path(routePath) {
  return `${relativePrefix(routePath)}assets/branding/icon-circle-512.png`;
}

function appleTouchPath(routePath) {
  return `${relativePrefix(routePath)}assets/branding/icon-ios-180.png`;
}

function rssPath(routePath) {
  return `${relativePrefix(routePath)}rss.xml`;
}

function absoluteRouteUrl(routePath) {
  if (!siteUrl) {
    return "";
  }
  if (routePath === "/") {
    return `${siteUrl}/`;
  }
  return `${siteUrl}${routePath}/`;
}

function canonicalTag(routePath) {
  const href = absoluteRouteUrl(routePath);
  return href ? `<link rel="canonical" href="${href}">` : "";
}

function ogUrlTag(routePath) {
  const content = absoluteRouteUrl(routePath);
  return content ? `<meta property="og:url" content="${content}">` : "";
}

function rfc822FromYyyyMmDd(yyyyMmDd) {
  const parts = parseDateParts(yyyyMmDd);
  if (!parts) {
    return "";
  }
  const dt = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 0, 0, 0, 0));
  return dt.toUTCString();
}

function cdataSafe(input) {
  return String(input || "").replaceAll("]]>", "]]]]><![CDATA[>");
}

function decodeBasicHtmlEntities(input) {
  return String(input || "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function htmlToPlainWithLineBreaks(input) {
  const withBreaks = String(input || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");
  return decodeBasicHtmlEntities(withBreaks).replace(/\n{3,}/g, "\n\n").trim();
}

function spacerToSpaces(spacerWidth) {
  const raw = String(spacerWidth || "").trim().toLowerCase();
  const chMatch = raw.match(/^(\d+(?:\.\d+)?)ch$/);
  if (chMatch) {
    const count = Math.max(1, Math.min(16, Math.round(Number(chMatch[1]))));
    return " ".repeat(count);
  }
  return "   ";
}

function withRssFriendlyAlignedPoetryLines(markdown) {
  const lines = String(markdown || "").split("\n");
  const transformed = [];
  let activeFenceChar = "";

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (!activeFenceChar) {
        activeFenceChar = markerChar;
      } else if (activeFenceChar === markerChar) {
        activeFenceChar = "";
      }
      transformed.push(line);
      continue;
    }

    if (activeFenceChar) {
      transformed.push(line);
      continue;
    }

    const segments = parsePoetryLineDirective(line);
    if (!segments) {
      transformed.push(line);
      continue;
    }

    const plainLine = segments
      .map((segment) => {
        if (segment.align === "~") {
          return spacerToSpaces(segment.spacerWidth);
        }
        return String(segment.text || "");
      })
      .join("")
      .replace(/\s+$/g, "");
    transformed.push(plainLine || " ");
  }

  return transformed.join("\n");
}

function renderRssPoemHtml(markdown, highlights = []) {
  const withMarks = withLegacyHighlights(markdown, highlights);
  const withAlignedLines = withRssFriendlyAlignedPoetryLines(withMarks);
  const withInlineColors = withInlineColorHighlights(withAlignedLines);
  return marked.parse(withInlineColors);
}

function fontPath(routePath, filename) {
  return `${relativePrefix(routePath)}assets/fonts/${filename}`;
}

function fontPreloads(routePath) {
  return [
    `<link rel="preload" href="${fontPath(routePath, "libre-baskerville-400.ttf")}" as="font" type="font/ttf" crossorigin>`,
    `<link rel="preload" href="${fontPath(routePath, "libre-baskerville-700.ttf")}" as="font" type="font/ttf" crossorigin>`
  ].join("\n  ");
}

function withLegacyHighlights(markdown, highlights = []) {
  let rendered = markdown;
  const tokens = [];
  let tokenIndex = 0;

  for (const item of highlights) {
    if (!item?.text) {
      continue;
    }

    const token = `__SEREIN_HL_${tokenIndex}__`;
    tokenIndex += 1;
    rendered = rendered.replaceAll(item.text, token);
    tokens.push({
      token,
      text: item.text,
      note: item.note || ""
    });
  }

  let safe = rendered;

  for (const item of tokens) {
    const note = item.note ? ` title="${htmlEscape(item.note)}"` : "";
    const mark = `<mark class="hand-highlight hl-yellow"${note}>${item.text}</mark>`;
    safe = safe.replaceAll(item.token, mark);
  }

  return safe;
}

function withInlineColorHighlights(markdown) {
  return String(markdown || "").replace(/==([^=\n][^=\n]*?)==/g, (_, rawInner) => {
    const inner = String(rawInner || "").trim();
    if (!inner) {
      return "====";
    }

    const parts = inner.split(/\s+/);
    const first = (parts[0] || "").toLowerCase();
    let color = "light-yellow";
    let text = inner;

    if (INLINE_HIGHLIGHT_COLORS.has(first) && parts.length > 1) {
      color = first === "yellow" ? "light-yellow" : first;
      text = inner.slice(parts[0].length).trim();
    }

    return `<mark class="hand-highlight hl-${color}">${htmlEscape(text)}</mark>`;
  });
}

function parsePoetryLineDirective(line) {
  const match = String(line || "").match(/^\s*::line\s+(.+)$/);
  if (!match) {
    return null;
  }

  const source = match[1];
  const segments = [];
  const tokenPattern = /\|([<^>~])((?:\\\||[^|])*)\|/g;
  let lastIndex = 0;

  for (const token of source.matchAll(tokenPattern)) {
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

  if (segments.length === 0 || source.slice(lastIndex).trim()) {
    return null;
  }

  return segments;
}

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

function withAlignedPoetryLines(markdown) {
  const lines = String(markdown || "").split("\n");
  const transformed = [];
  let activeFenceChar = "";

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (!activeFenceChar) {
        activeFenceChar = markerChar;
      } else if (activeFenceChar === markerChar) {
        activeFenceChar = "";
      }
      transformed.push(line);
      continue;
    }

    if (activeFenceChar) {
      transformed.push(line);
      continue;
    }

    const segments = parsePoetryLineDirective(line);
    if (!segments) {
      transformed.push(line);
      continue;
    }

    const template = segments
      .map((segment) => (segment.align === "~" ? segment.spacerWidth : "minmax(0, 1fr)"))
      .join(" ");
    const content = segments
      .map((segment) => {
        const { align } = segment;
        if (align === "~") {
          return `<span class="poetry-segment poetry-spacer" style="--poetry-spacer-width: ${segment.spacerWidth};"></span>`;
        }

        const { text } = segment;
        const alignClass = align === "<" ? "poetry-left" : align === "^" ? "poetry-center" : "poetry-right";
        const textAlignClass = segment.textAlign ? ` poetry-text-${segment.textAlign}` : "";
        const inner = marked.parseInline(text || "").trim() || "&nbsp;";
        return `<span class="poetry-segment ${alignClass}${textAlignClass}">${inner}</span>`;
      })
      .join("");
    transformed.push(
      `<div class="poetry-line" style="--poetry-cols: ${segments.length}; --poetry-template: ${template};">${content}</div>`
    );
  }

  return transformed.join("\n");
}

function withInlineStyledAlignedPoetryLines(markdown) {
  const lines = String(markdown || "").split("\n");
  const transformed = [];
  let activeFenceChar = "";

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (!activeFenceChar) {
        activeFenceChar = markerChar;
      } else if (activeFenceChar === markerChar) {
        activeFenceChar = "";
      }
      transformed.push(line);
      continue;
    }

    if (activeFenceChar) {
      transformed.push(line);
      continue;
    }

    const segments = parsePoetryLineDirective(line);
    if (!segments) {
      transformed.push(line);
      continue;
    }

    const template = segments
      .map((segment) => (segment.align === "~" ? segment.spacerWidth : "minmax(0,1fr)"))
      .join(" ");
    const content = segments
      .map((segment) => {
        if (segment.align === "~") {
          return `<span style="display:block;min-width:${segment.spacerWidth};"></span>`;
        }

        const align = segment.textAlign || (segment.align === "<" ? "left" : segment.align === "^" ? "center" : "right");
        const justify = segment.align === "<" ? "start" : segment.align === "^" ? "center" : "end";
        const inner = marked.parseInline(segment.text || "").trim() || "&nbsp;";
        return `<span style="display:block;min-width:0;text-align:${align};justify-self:${justify};">${inner}</span>`;
      })
      .join("");

    transformed.push(
      `<div style="display:grid;grid-template-columns:${template};column-gap:0;align-items:baseline;margin:0;">${content}</div>`
    );
  }

  return transformed.join("\n");
}

function validateCustomMarkdownSyntax(markdown, filename) {
  const lines = String(markdown || "").split("\n");
  let activeFenceChar = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (!activeFenceChar) {
        activeFenceChar = markerChar;
      } else if (activeFenceChar === markerChar) {
        activeFenceChar = "";
      }
      continue;
    }

    if (activeFenceChar) {
      continue;
    }

    if (!/^\s*::line\b/.test(line)) {
      continue;
    }

    if (!parsePoetryLineDirective(line)) {
      throw new Error(
        `Invalid ::line syntax in ${filename}:${i + 1}. Expected tokens like |<text| |^text| |>text|, optional text-align prefix (left:, center:, right:), or spacer |~10ch|.`
      );
    }
  }
}

function renderPoemMarkdown(markdown, highlights = []) {
  const withMarks = withLegacyHighlights(markdown, highlights);
  const withAlignedLines = withAlignedPoetryLines(withMarks);
  const withInlineColors = withInlineColorHighlights(withAlignedLines);
  return marked.parse(withInlineColors);
}

function renderRssPoemMarkdown(markdown, highlights = []) {
  const withMarks = withLegacyHighlights(markdown, highlights);
  const withAlignedLines = withInlineStyledAlignedPoetryLines(withMarks);
  const withInlineColors = withInlineColorHighlights(withAlignedLines);
  return marked.parse(withInlineColors);
}

function poemUsesCustomMarkup(markdown) {
  const source = String(markdown || "");
  if (/(^|\n)\s*::line\b/m.test(source)) {
    return true;
  }
  if (/==([^=\n][^=\n]*?)==/.test(source)) {
    return true;
  }
  return false;
}

function validatePoem(poem, filename) {
  const required = ["title", "author", "date", "poem"];

  for (const field of required) {
    if (!poem[field] || typeof poem[field] !== "string") {
      throw new Error(`Missing or invalid field '${field}' in ${filename}`);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(poem.date)) {
    throw new Error(`Invalid date '${poem.date}' in ${filename}. Expected YYYY-MM-DD.`);
  }

  if (!Array.isArray(poem.highlights)) {
    poem.highlights = [];
  }

  if (typeof poem.publication !== "string") {
    poem.publication = poem.publication == null ? "" : String(poem.publication);
  }
  if (typeof poem.source !== "string") {
    poem.source = poem.source == null ? "" : String(poem.source);
  }
}

async function loadPoems() {
  async function collectPoemFiles(dirPath, relDir = "") {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const entryRelPath = relDir ? path.join(relDir, entry.name) : entry.name;
      const entryFullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const nested = await collectPoemFiles(entryFullPath, entryRelPath);
        files.push(...nested);
        continue;
      }
      files.push({
        name: entry.name,
        relPath: entryRelPath,
        fullPath: entryFullPath
      });
    }

    return files;
  }

  const files = await collectPoemFiles(poemsDir);
  const poems = [];

  for (const file of files) {
    if (file.name.endsWith(".json")) {
      throw new Error(
        `Found unsupported poem file '${file.relPath}'. Only Markdown (.md) poem files are allowed.`
      );
    }
    if (!file.name.endsWith(".md")) {
      continue;
    }

    const raw = await readFile(file.fullPath, "utf8");
    const parsed = parsePoemMarkdownFile(raw, file.relPath);
    validatePoem(parsed, file.relPath);
    validateCustomMarkdownSyntax(parsed.poem, file.relPath);
    const expectedFilename = expectedPoemFilename(parsed);
    if (!expectedFilename) {
      throw new Error(`Could not derive expected filename from date/title in ${file.relPath}.`);
    }
    if (file.name !== expectedFilename) {
      throw new Error(
        `Invalid poem filename '${file.relPath}'. Expected '${expectedFilename}' (based on date + title). Run 'npm run normalize:filenames'.`
      );
    }

    const expectedSubdir = expectedPoemSubdirForDate(parsed.date);
    if (!expectedSubdir) {
      throw new Error(`Could not derive expected subdirectory from date in ${file.relPath}.`);
    }
    const actualSubdir = path.dirname(file.relPath);
    if (actualSubdir !== expectedSubdir) {
      throw new Error(
        `Invalid poem path '${file.relPath}'. Expected to be in '${expectedSubdir}'. Run 'npm run normalize:filenames'.`
      );
    }

    parsed.filename = file.name;
    parsed.filepath = file.relPath;
    parsed.route = toRoutePath(parsed.date);
    poems.push(parsed);
  }

  poems.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return poems;
}

function preparePoems(poems) {
  return poems.map((poem) => ({
    ...poem,
    authorMetaHtml: renderAuthorMeta(poem),
    poemHtml: renderPoemMarkdown(poem.poem, poem.highlights),
    searchText: markdownStrip(poem.poem)
  }));
}

function renderFooter(routePath) {
  const prefix = relativePrefix(routePath);
  const links = [];
  if (routePath !== "/") {
    links.push(`<a href="${prefix}">Today</a>`);
  }
  links.push(`<a href="${prefix}archive/">Archive</a>`);
  links.push(`<a href="${prefix}about/">About</a>`);
  return `<footer class="site-footer">${links.join('<span aria-hidden="true">&bull;</span>')}</footer>`;
}

function renderPublicationMeta(poem) {
  const publication = htmlEscape(poem.publication || "");
  const source = String(poem.source || "").trim();
  if (!publication && !source) {
    return "";
  }
  if (!source) {
    return publication;
  }
  if (!publication) {
    return `<a href="${htmlEscape(source)}" target="_blank" rel="noreferrer">Source</a>`;
  }
  return `${publication} <span aria-hidden="true">&middot;</span> <a href="${htmlEscape(source)}" target="_blank" rel="noreferrer">Source</a>`;
}

function renderAuthorMeta(poem) {
  const author = htmlEscape(poem.author || "");
  const details = renderPublicationMeta(poem);
  if (!details) {
    return author;
  }
  return `${author} <span aria-hidden="true">&middot;</span> ${details}`;
}

function renderPoemShell(template, poem, { noindex = true, routePath = "/" } = {}) {
  const description = `${poem.title} by ${poem.author}.`;
  const authorMeta = poem.authorMetaHtml || renderAuthorMeta(poem);
  const poemHtml = poem.poemHtml || renderPoemMarkdown(poem.poem, poem.highlights);
  return template
    .replaceAll("{{TITLE}}", htmlEscape(poem.title))
    .replaceAll("{{AUTHOR}}", htmlEscape(poem.author))
    .replaceAll("{{DESCRIPTION}}", htmlEscape(description))
    .replaceAll("{{PUBLICATION}}", htmlEscape(poem.publication))
    .replaceAll("{{DATE}}", htmlEscape(poem.date))
    .replaceAll("{{AUTHOR_META}}", authorMeta)
    .replaceAll("{{PUBLICATION_META}}", renderPublicationMeta(poem))
    .replaceAll("{{POEM_TEXT}}", poemHtml)
    .replace("{{ASSET_PATH}}", assetPath(routePath))
    .replace("{{FONT_PRELOADS}}", fontPreloads(routePath))
    .replace("{{MANIFEST_PATH}}", manifestPath(routePath))
    .replace("{{RSS_PATH}}", rssPath(routePath))
    .replace("{{FAVICON_32_PATH}}", favicon32Path(routePath))
    .replace("{{FAVICON_512_PATH}}", favicon512Path(routePath))
    .replace("{{APPLE_TOUCH_ICON_PATH}}", appleTouchPath(routePath))
    .replace("{{SCRIPT_PATH}}", scriptPath(routePath))
    .replace("{{ROBOTS_META}}", noindex ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow">')
    .replace("{{CANONICAL_TAG}}", canonicalTag(routePath))
    .replace("{{OG_URL_TAG}}", ogUrlTag(routePath))
    .replace("{{FOOTER}}", renderFooter(routePath));
}

async function writeRoutedPage(routePath, html) {
  if (routePath === "/") {
    await writeFile(path.join(distDir, "index.html"), html, "utf8");
    return;
  }

  const rel = routePath.slice(1);
  const dirPath = path.join(distDir, rel);
  await mkdir(dirPath, { recursive: true });
  await writeFile(path.join(dirPath, "index.html"), html, "utf8");
}

async function renderPoemPages(publishedPoems) {
  const template = await readTemplate("poem.html");

  for (const poem of publishedPoems) {
    const html = renderPoemShell(template, poem, { noindex: false, routePath: poem.route });
    await writeRoutedPage(poem.route, html);
  }
}

async function renderArchive(poems, defaultAsOf = "") {
  const template = await readTemplate("archive.html");
  const fallbackDate = defaultAsOf || yyyyMmDdInTimeZone("Europe/Istanbul");
  const fallbackPoems = poems.filter((poem) => poem.date <= fallbackDate);
  const rows = renderArchiveTree(fallbackPoems, fallbackDate);
  const html = template
    .replace("{{DEFAULT_AS_OF}}", htmlEscape(defaultAsOf))
    .replace("{{FALLBACK_ARCHIVE_ROWS}}", rows)
    .replace("{{ASSET_PATH}}", assetPath("/archive"))
    .replace("{{FONT_PRELOADS}}", fontPreloads("/archive"))
    .replace("{{MANIFEST_PATH}}", manifestPath("/archive"))
    .replace("{{RSS_PATH}}", rssPath("/archive"))
    .replace("{{FAVICON_32_PATH}}", favicon32Path("/archive"))
    .replace("{{FAVICON_512_PATH}}", favicon512Path("/archive"))
    .replace("{{APPLE_TOUCH_ICON_PATH}}", appleTouchPath("/archive"))
    .replace("{{SCRIPT_PATH}}", scriptPath("/archive"))
    .replace("{{ROBOTS_META}}", '<meta name="robots" content="index, follow">')
    .replace("{{CANONICAL_TAG}}", canonicalTag("/archive"))
    .replace("{{OG_URL_TAG}}", ogUrlTag("/archive"))
    .replace("{{FOOTER}}", renderFooter("/archive"));

  await writeRoutedPage("/archive", html);
}

async function renderAbout() {
  const template = await readTemplate("about.html");
  const html = template
    .replace("{{ASSET_PATH}}", assetPath("/about"))
    .replace("{{FONT_PRELOADS}}", fontPreloads("/about"))
    .replace("{{MANIFEST_PATH}}", manifestPath("/about"))
    .replace("{{RSS_PATH}}", rssPath("/about"))
    .replace("{{FAVICON_32_PATH}}", favicon32Path("/about"))
    .replace("{{FAVICON_512_PATH}}", favicon512Path("/about"))
    .replace("{{APPLE_TOUCH_ICON_PATH}}", appleTouchPath("/about"))
    .replace("{{SCRIPT_PATH}}", scriptPath("/about"))
    .replace("{{CANONICAL_TAG}}", canonicalTag("/about"))
    .replace("{{OG_URL_TAG}}", ogUrlTag("/about"))
    .replace("{{FOOTER}}", renderFooter("/about"));
  await writeRoutedPage("/about", html);
}

async function renderHome(poems, defaultAsOf = "") {
  const template = await readTemplate("index.html");
  const fallbackDate = defaultAsOf || yyyyMmDdInTimeZone("Europe/Istanbul");
  const fallbackPoems = poems.filter((poem) => poem.date <= fallbackDate);
  const fallbackPoem = fallbackPoems.find((poem) => poem.date === fallbackDate) || fallbackPoems[fallbackPoems.length - 1] || null;
  const fallbackTitle = fallbackPoem ? htmlEscape(fallbackPoem.title) : "A Poem Per Day";
  const fallbackMeta = fallbackPoem ? fallbackPoem.authorMetaHtml || renderAuthorMeta(fallbackPoem) : "";
  const fallbackBody = fallbackPoem
    ? fallbackPoem.poemHtml || renderPoemMarkdown(fallbackPoem.poem, fallbackPoem.highlights)
    : '<p class="empty">No poem is published for today.</p>';
  const html = template
    .replaceAll("{{PAGE_TITLE}}", "A Poem Per Day")
    .replaceAll("{{PAGE_DESCRIPTION}}", "A Poem Per Day.")
    .replace("{{DEFAULT_AS_OF}}", htmlEscape(defaultAsOf))
    .replace("{{FALLBACK_TITLE}}", fallbackTitle)
    .replace("{{FALLBACK_META}}", fallbackMeta)
    .replace("{{FALLBACK_POEM_HTML}}", fallbackBody)
    .replace("{{ASSET_PATH}}", assetPath("/"))
    .replace("{{FONT_PRELOADS}}", fontPreloads("/"))
    .replace("{{MANIFEST_PATH}}", manifestPath("/"))
    .replace("{{RSS_PATH}}", rssPath("/"))
    .replace("{{FAVICON_32_PATH}}", favicon32Path("/"))
    .replace("{{FAVICON_512_PATH}}", favicon512Path("/"))
    .replace("{{APPLE_TOUCH_ICON_PATH}}", appleTouchPath("/"))
    .replace("{{SCRIPT_PATH}}", scriptPath("/"))
    .replace("{{ROBOTS_META}}", '<meta name="robots" content="index, follow">')
    .replace("{{CANONICAL_TAG}}", canonicalTag("/"))
    .replace("{{OG_URL_TAG}}", ogUrlTag("/"))
    .replace("{{FOOTER}}", renderFooter("/"));

  await writeRoutedPage("/", html);
}

function monthLabel(monthNumber) {
  const month = Number(monthNumber);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return monthNumber;
  }
  const dt = new Date(Date.UTC(2024, month - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(dt);
}

function renderArchiveRow(poem, fromRoute) {
  const href = `${relativePrefix(fromRoute)}${poem.route.slice(1)}/`;
  const parts = parseDateParts(poem.date);
  const day = parts ? parts.day : "--";
  return `<li><span class="archive-day">${htmlEscape(day)}</span><span aria-hidden="true">&middot;</span><a href="${htmlEscape(href)}">${htmlEscape(poem.title)}</a></li>`;
}

function groupPoemsByYearMonth(publishedPoems) {
  const groups = new Map();

  for (const poem of publishedPoems.slice().sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))) {
    const parts = parseDateParts(poem.date);
    if (!parts) {
      continue;
    }

    if (!groups.has(parts.year)) {
      groups.set(parts.year, new Map());
    }
    const yearMap = groups.get(parts.year);
    if (!yearMap.has(parts.month)) {
      yearMap.set(parts.month, []);
    }
    yearMap.get(parts.month).push(poem);
  }

  return groups;
}

function renderArchiveTree(publishedPoems, today) {
  const todayParts = parseDateParts(today);
  const currentYear = todayParts?.year || "";
  const currentMonth = todayParts?.month || "";
  const grouped = groupPoemsByYearMonth(publishedPoems);
  const years = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));

  if (years.length === 0) {
    return "<p>No published poems yet.</p>";
  }

  return years
    .map((year) => {
      const monthsMap = grouped.get(year);
      const months = Array.from(monthsMap.keys()).sort((a, b) => b.localeCompare(a));
      const yearOpen = year === currentYear ? " open" : "";
      const monthBlocks = months
        .map((month) => {
          const poems = monthsMap.get(month);
          const monthOpen = year === currentYear && month === currentMonth ? " open" : "";
          const rows = poems.map((poem) => renderArchiveRow(poem, "/archive")).join("");
          return `<details class="archive-month"${monthOpen}><summary>${htmlEscape(monthLabel(month))}</summary><ul class="archive-poems">${rows}</ul></details>`;
        })
        .join("");
      return `<details class="archive-year"${yearOpen}><summary>${htmlEscape(year)}</summary><div class="archive-months">${monthBlocks}</div></details>`;
    })
    .join("");
}

async function renderSearchData(poems) {
  const lightweight = poems.map((poem) => ({
    id: poem.id,
    title: poem.title,
    author: poem.author,
    publication: poem.publication,
    date: poem.date,
    route: poem.route,
    text: poem.searchText || markdownStrip(poem.poem)
  }));

  await writeFile(path.join(distDir, "search-index.json"), JSON.stringify(lightweight, null, 2), "utf8");
}

async function renderPoemsData(poems) {
  const full = poems.map((poem) => {
    const parts = parseDateParts(poem.date) || { year: "", month: "", day: "" };
    return {
      id: poem.id,
      title: poem.title,
      author: poem.author,
      publication: poem.publication,
      source: poem.source,
      date: poem.date,
      route: poem.route,
      dateParts: parts,
      authorMetaHtml: poem.authorMetaHtml || renderAuthorMeta(poem),
      poemHtml: poem.poemHtml || renderPoemMarkdown(poem.poem, poem.highlights)
    };
  });

  await writeFile(path.join(distDir, "poems-data.json"), JSON.stringify(full, null, 2), "utf8");
}

async function copyAssets() {
  await copyFile(path.join(assetsDir, "styles.css"), path.join(distDir, "assets", "styles.css"));
  await copyFile(path.join(assetsDir, "app.js"), path.join(distDir, "assets", "app.js"));
  await copyFile(path.join(assetsDir, "site.webmanifest"), path.join(distDir, "site.webmanifest"));
  await cp(path.join(assetsDir, "fonts"), path.join(distDir, "assets", "fonts"), { recursive: true });
  await cp(path.join(assetsDir, "highlights"), path.join(distDir, "assets", "highlights"), { recursive: true });
  await cp(path.join(assetsDir, "branding"), path.join(distDir, "assets", "branding"), { recursive: true });
  await copyFile(path.join(assetsDir, "branding", "icon-circle.ico"), path.join(distDir, "favicon.ico"));
}

async function renderNotFoundPage() {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#EFE2D0">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="A Poem Per Day">
  <meta name="robots" content="noindex, nofollow">
  <meta name="description" content="Page not found.">
  <title>404 | A Poem Per Day</title>
  <link rel="stylesheet" href="/assets/styles.css">
  <link rel="preload" href="/assets/fonts/libre-baskerville-400.ttf" as="font" type="font/ttf" crossorigin>
  <link rel="preload" href="/assets/fonts/libre-baskerville-700.ttf" as="font" type="font/ttf" crossorigin>
  <link rel="manifest" href="/site.webmanifest">
  <link rel="alternate" type="application/rss+xml" title="A Poem Per Day RSS Feed" href="/rss.xml">
  <link rel="icon" type="image/png" sizes="512x512" href="/assets/branding/icon-circle-512.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/branding/icon-circle-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/branding/icon-ios-180.png">
</head>
<body>
  <main>
    <h1>Page Not Found</h1>
    <article class="content-block">
      <p>The page you requested does not exist.</p>
      <p><a href="/">Go to Today</a> or browse the <a href="/archive/">archive</a>.</p>
    </article>
  </main>
  <footer class="site-footer"><a href="/">Today</a><span aria-hidden="true">&bull;</span><a href="/archive/">Archive</a><span aria-hidden="true">&bull;</span><a href="/about/">About</a></footer>
</body>
</html>
`;
  await writeFile(path.join(distDir, "404.html"), html, "utf8");
}

async function renderSeoFiles(publishedPoems) {
  const robotsLines = ["User-agent: *", "Allow: /"];
  if (siteUrl) {
    robotsLines.push(`Sitemap: ${siteUrl}/sitemap.xml`);
  }
  await writeFile(path.join(distDir, "robots.txt"), `${robotsLines.join("\n")}\n`, "utf8");

  if (!siteUrl) {
    return;
  }

  const routePaths = ["/", "/archive", "/about", ...publishedPoems.map((poem) => poem.route)];
  const uniqueRoutes = Array.from(new Set(routePaths));
  const urls = uniqueRoutes
    .map((routePath) => {
      const loc = absoluteRouteUrl(routePath);
      if (!loc) {
        return "";
      }
      return `<url><loc>${htmlEscape(loc)}</loc></url>`;
    })
    .filter(Boolean)
    .join("");

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>
`;
  await writeFile(path.join(distDir, "sitemap.xml"), sitemapXml, "utf8");
}

async function renderRssFeed(poems, defaultAsOf = "") {
  if (!siteUrl) {
    console.warn("Skipped RSS feed generation because SITE_URL is not set.");
    return;
  }

  const fallbackDate = defaultAsOf || yyyyMmDdInTimeZone("Europe/Istanbul");
  const published = poems
    .filter((poem) => poem.date <= fallbackDate)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

  const channelLink = `${siteUrl}/`;
  const selfLink = `${siteUrl}/rss.xml`;
  const buildDate = new Date().toUTCString();

  const items = published
    .map((poem) => {
      const link = absoluteRouteUrl(poem.route);
      if (!link) {
        return "";
      }

      const pubDate = rfc822FromYyyyMmDd(poem.date);
      const itemTitle = poem.title;
      const poemHtml = renderRssPoemMarkdown(poem.poem, poem.highlights);
      const authorLine = `<p>by <strong>${htmlEscape(poem.author)}</strong></p>`;
      const contentHtml = poemUsesCustomMarkup(poem.poem)
        ? `<p>This poem uses special formatting that is not suited for RSS feeds. Please <a href="${htmlEscape(
            link
          )}">visit the website to read it</a>.</p>`
        : `${poemHtml}<p>&nbsp;</p>${authorLine}`;

      return `<item>
      <title>${htmlEscape(itemTitle)}</title>
      <link>${htmlEscape(link)}</link>
      <guid isPermaLink="true">${htmlEscape(link)}</guid>
      <pubDate>${htmlEscape(pubDate)}</pubDate>
      <dc:creator>${htmlEscape(poem.author)}</dc:creator>
      <description><![CDATA[]]></description>
      <content:encoded><![CDATA[${cdataSafe(contentHtml)}]]></content:encoded>
    </item>`;
    })
    .filter(Boolean)
    .join("\n");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>A Poem Per Day</title>
    <link>${htmlEscape(channelLink)}</link>
    <description>Daily poems from A Poem Per Day.</description>
    <language>en</language>
    <lastBuildDate>${htmlEscape(buildDate)}</lastBuildDate>
    <atom:link href="${htmlEscape(selfLink)}" rel="self" type="application/rss+xml" />
${items ? `${items}\n` : ""}  </channel>
</rss>
`;

  await writeFile(path.join(distDir, "rss.xml"), rss, "utf8");
}

export async function build() {
  await ensureDist();
  const poems = preparePoems(await loadPoems());
  const asOfDate = parseAsOfDateArg();

  await Promise.all([
    renderHome(poems, asOfDate),
    renderPoemPages(poems),
    renderArchive(poems, asOfDate),
    renderAbout(),
    renderSearchData(poems),
    renderPoemsData(poems),
    renderSeoFiles(poems),
    renderRssFeed(poems, asOfDate),
    renderNotFoundPage(),
    copyAssets()
  ]);

  console.log(`Built Serein with ${poems.length} poems (local-date rendering enabled on / and /archive).`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await build();
}

if (watchMode && isDirectRun) {
  const { watch } = await import("node:fs");
  console.log("Watch mode enabled.");
  const watchTargets = ["poems", "assets", "templates", "scripts"].map((dir) => path.join(root, dir));
  let buildInFlight = false;
  let buildQueued = false;
  let debounceTimer = null;

  async function runBuild() {
    if (buildInFlight) {
      buildQueued = true;
      return;
    }

    buildInFlight = true;
    try {
      await build();
    } catch (error) {
      console.error(error);
    } finally {
      buildInFlight = false;
      if (buildQueued) {
        buildQueued = false;
        await runBuild();
      }
    }
  }

  function scheduleBuild() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runBuild();
    }, 200);
  }

  for (const target of watchTargets) {
    watch(target, { recursive: true }, scheduleBuild);
  }
}
