import { mkdir, readdir, readFile, rm, writeFile, copyFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { marked } from "marked";
import { expectedPoemFilename } from "./poem-filenames.mjs";
import { duplicatePoemGroups } from "./poem-duplicates.mjs";
import { parsePoetryLineDirective } from "./poetry-line.mjs";

const root = process.cwd();
const poemsDir = path.join(root, "poems");
const cacheDir = path.join(root, ".cache");
const socialCardCacheDir = path.join(cacheDir, "social-cards");
const reportsDir = path.join(root, "reports");
const templatesDir = path.join(root, "templates");
const assetsDir = path.join(root, "assets");
const siteUrl = String(process.env.SITE_URL || "").trim().replace(/\/+$/, "");

function resolveDistDir(env = process.env) {
  const raw = String(env.SEREIN_DIST_DIR || "").trim();
  if (!raw) {
    return path.join(root, "dist");
  }
  return path.isAbsolute(raw) ? path.normalize(raw) : path.join(root, raw);
}

const distDir = resolveDistDir();

const watchMode = process.argv.includes("--watch");
const runtimeAsOfEnabled = (
  String(process.env.SEREIN_ENABLE_RUNTIME_AS_OF || "").trim() === "1"
  || String(process.env.CODESPACES || "").trim().toLowerCase() === "true"
);
const bundledAssetEntries = {
  styles: path.join(assetsDir, "styles.css"),
  home: path.join(assetsDir, "scripts", "home.js"),
  archive: path.join(assetsDir, "scripts", "archive.js"),
  poets: path.join(assetsDir, "scripts", "poets.js"),
  poetPage: path.join(assetsDir, "scripts", "poet-page.js"),
  about: path.join(assetsDir, "scripts", "about.js"),
  poem: path.join(assetsDir, "scripts", "poem.js")
};
const fontSourceEntries = {
  regular400: path.join(assetsDir, "fonts", "libre-baskerville-400.woff2"),
  bold700: path.join(assetsDir, "fonts", "libre-baskerville-700.woff2")
};
const iconSourceEntries = {
  circle32: path.join(assetsDir, "branding", "icon-circle-32.png"),
  circle192: path.join(assetsDir, "branding", "icon-circle-192.png"),
  circle512: path.join(assetsDir, "branding", "icon-circle-512.png"),
  ios180: path.join(assetsDir, "branding", "icon-ios-180.png"),
  faviconIco: path.join(assetsDir, "branding", "icon-circle.ico")
};
let assetManifest = null;
let esbuildBundleFn = null;
let htmlMinifyFn = null;
let sharpFactory = null;
let poetPages = [];
let socialCardManifest = null;
let socialCardStats = { generated: 0, cached: 0 };
let socialCardFontConfigPath = "";
let homePoemDataCache = new Map();
let poemPageDataCache = new Map();
const fileStatCache = new Map();
const SOCIAL_CARD_CACHE_VERSION = "png-v5-fontconfig-fallback";
const BACKGROUND_TASK_CONCURRENCY = 4;

function readArgValue(flagName) {
  const exactIndex = process.argv.indexOf(flagName);
  if (exactIndex >= 0) {
    return process.argv[exactIndex + 1] || "";
  }
  return "";
}

function parseAsOfDateArg() {
  const raw = String(
    readArgValue("--as-of")
      || process.env.SEREIN_AS_OF
      || process.env.npm_config_as_of
      || process.env.npm_config_date
      || ""
  ).trim();
  if (!raw) {
    return "";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid --as-of value '${raw}'. Expected YYYY-MM-DD.`);
  }
  return raw;
}

function runtimeAsOfDataValue() {
  return runtimeAsOfEnabled ? "1" : "0";
}

marked.setOptions({
  gfm: true,
  breaks: true
});

async function ensureDist() {
  const isTransientCleanupError = (error) => {
    const code = String(error?.code || "");
    return code === "EBUSY" || code === "ENOTEMPTY" || code === "EPERM" || code === "UNKNOWN";
  };
  const cleanupRetryDelaysMs = [50, 100, 250, 500];
  const removeWithRetries = async (targetPath) => {
    let lastError = null;

    for (let attempt = 0; attempt <= cleanupRetryDelaysMs.length; attempt += 1) {
      try {
        await rm(targetPath, { recursive: true, force: true });
      } catch (error) {
        if (!isTransientCleanupError(error)) {
          throw error;
        }
        lastError = error;
      }

      if (!(await fileExists(targetPath))) {
        return;
      }

      if (attempt < cleanupRetryDelaysMs.length) {
        await new Promise((resolve) => setTimeout(resolve, cleanupRetryDelaysMs[attempt]));
      }
    }

    const relativePath = path.relative(root, targetPath) || targetPath;
    const code = String(lastError?.code || "UNKNOWN");
    throw new Error(`Could not remove stale build output '${relativePath}' (${code}). Close any processes using it and rerun the build.`);
  };

  await mkdir(distDir, { recursive: true });
  const entries = await readdir(distDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(distDir, entry.name);
    if (entry.name === "assets") {
      const assetsEntries = await readdir(fullPath, { withFileTypes: true }).catch(() => []);
      for (const assetEntry of assetsEntries) {
        await removeWithRetries(path.join(fullPath, assetEntry.name));
      }
      continue;
    }

    await removeWithRetries(fullPath);
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

function jsonLdEscape(input) {
  return String(input || "")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function markdownStrip(input) {
  return String(input || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_`~>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function readTemplate(name) {
  const fullPath = path.join(templatesDir, name);
  return readFile(fullPath, "utf8");
}

async function cachedStat(targetPath) {
  const normalizedPath = path.normalize(targetPath);
  if (fileStatCache.has(normalizedPath)) {
    return fileStatCache.get(normalizedPath);
  }
  const targetStat = await stat(normalizedPath);
  fileStatCache.set(normalizedPath, targetStat);
  return targetStat;
}

function mostRecentIsoTimestamp(values) {
  const timestamps = values
    .map((value) => {
      if (!value) {
        return NaN;
      }
      if (value instanceof Date) {
        return value.getTime();
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? NaN : parsed.getTime();
    })
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return "";
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function sitemapLastmodTag(lastModifiedAt) {
  const raw = String(lastModifiedAt || "").trim();
  if (!raw) {
    return "";
  }
  return `<lastmod>${htmlEscape(raw)}</lastmod>`;
}

function jsonLdScript(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  return `<script type="application/ld+json">${jsonLdEscape(JSON.stringify(value))}</script>`;
}

async function loadEsbuildBundle() {
  if (esbuildBundleFn) {
    return esbuildBundleFn;
  }

  try {
    ({ build: esbuildBundleFn } = await import("esbuild"));
    return esbuildBundleFn;
  } catch (error) {
    if (String(error?.code || "") === "ERR_MODULE_NOT_FOUND") {
      throw new Error("Missing build dependency 'esbuild'. Run 'npm install' (or 'npm ci') before running 'npm run build'.");
    }
    throw error;
  }
}

async function loadHtmlMinifier() {
  if (htmlMinifyFn) {
    return htmlMinifyFn;
  }

  try {
    ({ minify: htmlMinifyFn } = await import("html-minifier-terser"));
    return htmlMinifyFn;
  } catch (error) {
    if (String(error?.code || "") === "ERR_MODULE_NOT_FOUND") {
      throw new Error("Missing build dependency 'html-minifier-terser'. Run 'npm install' (or 'npm ci') before running 'npm run build'.");
    }
    throw error;
  }
}

async function loadSharpFactory() {
  if (sharpFactory) {
    return sharpFactory;
  }

  try {
    await ensureSocialCardFontConfig();
    const sharpModule = await import("sharp");
    sharpFactory = sharpModule.default;
    return sharpFactory;
  } catch (error) {
    if (String(error?.code || "") === "ERR_MODULE_NOT_FOUND") {
      throw new Error("Missing build dependency 'sharp'. Run 'npm install' (or 'npm ci') before running 'npm run build'.");
    }
    throw error;
  }
}

function xmlEscape(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function ensureSocialCardFontConfig() {
  if (socialCardFontConfigPath) {
    return socialCardFontConfigPath;
  }

  const fontCacheDir = path.join(cacheDir, "fontconfig");
  const configPath = path.join(fontCacheDir, "fonts.conf");
  await mkdir(fontCacheDir, { recursive: true });
  const fontDirectories = [
    path.join(assetsDir, "fonts"),
    process.env.WINDIR ? path.join(process.env.WINDIR, "Fonts") : "",
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    "/usr/share/fonts/truetype",
    "/usr/share/fonts/opentype",
    "/System/Library/Fonts",
    "/Library/Fonts"
  ]
    .map((dir) => String(dir || "").trim())
    .filter(Boolean);
  const fontDirectoryTags = [...new Set(fontDirectories)]
    .map((dir) => `  <dir>${xmlEscape(dir)}</dir>`)
    .join("\n");

  const fontConfigXml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
${fontDirectoryTags}
  <cachedir>${xmlEscape(fontCacheDir)}</cachedir>
  <config></config>
</fontconfig>
`;

  await writeFile(configPath, fontConfigXml, "utf8");
  process.env.FONTCONFIG_FILE = configPath;
  process.env.FONTCONFIG_PATH = fontCacheDir;
  socialCardFontConfigPath = configPath;
  return socialCardFontConfigPath;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function outputWebPath(filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  return `/${path.relative(distDir, absolutePath).split(path.sep).join("/")}`;
}

function fingerprintContents(contents) {
  return createHash("sha256").update(contents).digest("hex").slice(0, 10);
}

function socialCardCacheKey(svgContents) {
  return createHash("sha256")
    .update(SOCIAL_CARD_CACHE_VERSION)
    .update("\n")
    .update(svgContents)
    .digest("hex");
}

async function writeFingerprintedAsset({ name, extension, subdir = "assets", contents }) {
  const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents), "utf8");
  const filename = `${name}-${fingerprintContents(buffer)}${extension}`;
  const relativePath = path.posix.join(subdir, filename);
  const outputPath = path.join(distDir, ...relativePath.split("/"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
  return `/${relativePath}`;
}

async function copyFingerprintedAsset(sourcePath, options = {}) {
  const ext = path.extname(sourcePath);
  const name = path.basename(sourcePath, ext);
  const contents = await readFile(sourcePath);
  return writeFingerprintedAsset({
    name,
    extension: ext,
    subdir: options.subdir || "assets",
    contents
  });
}

function bundledOutputByEntry(metafile, entryPath) {
  const normalizedEntry = path.normalize(entryPath);

  for (const [outputPath, meta] of Object.entries(metafile.outputs || {})) {
    if (!meta.entryPoint) {
      continue;
    }

    const resolvedEntry = path.normalize(path.join(root, meta.entryPoint));
    if (resolvedEntry === normalizedEntry) {
      return outputWebPath(outputPath);
    }
  }

  return "";
}

function bundledOutputByInput(metafile, inputPath) {
  const normalizedInput = path.normalize(inputPath);

  for (const [outputPath, meta] of Object.entries(metafile.outputs || {})) {
    const inputEntries = Object.keys(meta.inputs || {});
    for (const candidate of inputEntries) {
      const resolvedInput = path.normalize(path.join(root, candidate));
      if (resolvedInput === normalizedInput) {
        return outputWebPath(outputPath);
      }
    }
  }

  return "";
}

async function minifyPageHtml(html) {
  const minify = await loadHtmlMinifier();
  return minify(String(html || ""), {
    collapseWhitespace: true,
    conservativeCollapse: true,
    keepClosingSlash: true,
    minifyCSS: true,
    minifyJS: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    useShortDoctype: true
  });
}

function normalizeNewlines(input) {
  return String(input || "").replace(/\r\n/g, "\n");
}

function stripWrappingQuotes(input) {
  const raw = String(input || "").trim();
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\");
  }
  if (
    (raw.startsWith("\u201C") && raw.endsWith("\u201D"))
    || (raw.startsWith("\u2018") && raw.endsWith("\u2019"))
  ) {
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
    poet: "",
    translator: "",
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

    if (key === "author") {
      poem.poet = stripWrappingQuotes(value);
      continue;
    }

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

function addDaysToYyyyMmDd(yyyyMmDd, dayCount) {
  const parts = parseDateParts(yyyyMmDd);
  if (!parts || !Number.isInteger(dayCount)) {
    return "";
  }

  const dt = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  dt.setUTCDate(dt.getUTCDate() + dayCount);
  return dt.toISOString().slice(0, 10);
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

function requireAssetManifest() {
  if (!assetManifest) {
    throw new Error("Asset manifest is not ready yet.");
  }
  return assetManifest;
}

function routeRelativeAssetUrl(routePath, assetUrl) {
  const normalized = String(assetUrl || "").replace(/^\/+/, "");
  return `${relativePrefix(routePath)}${normalized}`;
}

function assetPath(routePath) {
  return routeRelativeAssetUrl(routePath, requireAssetManifest().css);
}

function scriptPath(routePath, pageName) {
  return routeRelativeAssetUrl(routePath, requireAssetManifest().scripts[pageName]);
}

function manifestPath(routePath) {
  return routeRelativeAssetUrl(routePath, requireAssetManifest().manifest);
}

function favicon32Path(routePath) {
  return routeRelativeAssetUrl(routePath, requireAssetManifest().icons.circle32);
}

function favicon512Path(routePath) {
  return routeRelativeAssetUrl(routePath, requireAssetManifest().icons.circle512);
}

function appleTouchPath(routePath) {
  return routeRelativeAssetUrl(routePath, requireAssetManifest().icons.ios180);
}

function pageDataPath(routePath, pageName) {
  return routeRelativeAssetUrl(routePath, requireAssetManifest().data[pageName]);
}

function poetPageDataPath(routePath) {
  const assetUrl = requireAssetManifest().poetPages?.[routePath] || "";
  return assetUrl ? routeRelativeAssetUrl(routePath, assetUrl) : "";
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

function absoluteAssetUrl(webPath) {
  if (!siteUrl || !webPath) {
    return "";
  }
  return `${siteUrl}${String(webPath).startsWith("/") ? "" : "/"}${webPath}`;
}

function routeHref(routePath) {
  if (routePath === "/") {
    return "/";
  }
  return `${routePath}/`;
}

function routeLink(routePath, label) {
  return `<a href="${htmlEscape(routeHref(routePath))}">${htmlEscape(label)}</a>`;
}

function canonicalTag(routePath) {
  const href = absoluteRouteUrl(routePath);
  return href ? `<link rel="canonical" href="${href}">` : "";
}

function ogUrlTag(routePath) {
  const content = absoluteRouteUrl(routePath);
  return content ? `<meta property="og:url" content="${content}">` : "";
}

function wrapCardText(text, maxCharsPerLine, maxLines) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) {
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  const consumedWordCount = lines.join(" ").split(/\s+/).filter(Boolean).length;
  if (consumedWordCount < words.length && lines.length > 0) {
    const lastIndex = lines.length - 1;
    lines[lastIndex] = `${lines[lastIndex].replace(/[.?!,:;…-]*$/g, "")}\u2026`;
  }

  return lines;
}

function renderCenteredCardTextLines(lines, { centerX, startY, size, lineHeight, weight = "400", fill = "#ebe0d2" }) {
  return lines
    .map(
      // Prefer the bundled face, but keep system serif families available for Linux-based build environments.
      (line, index) => `<text x="${centerX}" y="${startY + (index * lineHeight)}" text-anchor="middle" font-family="'Libre Baskerville', 'Noto Serif', 'DejaVu Serif', Georgia, serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${htmlEscape(line)}</text>`
    )
    .join("");
}

function versionedSocialCardPath(webPath, svgContents) {
  const normalizedPath = String(webPath || "").trim();
  if (!normalizedPath) {
    return "";
  }
  return `${normalizedPath}?v=${socialCardCacheKey(svgContents).slice(0, 12)}`;
}

function renderSocialCardSvg({ title, subtitle = "" }) {
  const titleLines = wrapCardText(title, 18, 4);
  const subtitleLines = subtitle ? wrapCardText(subtitle, 28, 2) : [];
  const titleSize = titleLines.length >= 4 ? 68 : titleLines.length === 3 ? 76 : 88;
  const titleLineHeight = titleLines.length >= 4 ? 84 : titleLines.length === 3 ? 92 : 102;
  const subtitleSize = 40;
  const subtitleLineHeight = 52;
  const titleBlockHeight = titleLines.length > 0 ? ((titleLines.length - 1) * titleLineHeight) + titleSize : 0;
  const subtitleBlockHeight = subtitleLines.length > 0 ? ((subtitleLines.length - 1) * subtitleLineHeight) + subtitleSize : 0;
  const gap = subtitleLines.length > 0 ? 40 : 0;
  const totalHeight = titleBlockHeight + gap + subtitleBlockHeight;
  const titleStartY = ((630 - totalHeight) / 2) + titleSize;
  const subtitleStartY = titleStartY + titleBlockHeight + gap;
  const description = subtitle || title;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="card-title card-detail">
  <title id="card-title">${htmlEscape(title)}</title>
  <desc id="card-detail">${htmlEscape(description)}</desc>
  <rect width="1200" height="630" fill="#1d1711"/>
  ${renderCenteredCardTextLines(titleLines, { centerX: 600, startY: titleStartY, size: titleSize, lineHeight: titleLineHeight, weight: "700", fill: "#ebe0d2" })}
  ${renderCenteredCardTextLines(subtitleLines, { centerX: 600, startY: subtitleStartY, size: subtitleSize, lineHeight: subtitleLineHeight, fill: "#c0b39f" })}
</svg>
`;
}

async function writeSocialCard(filename, svgContents) {
  const outputPath = path.join(distDir, "social", filename);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(socialCardCacheDir, { recursive: true });

  const cacheKey = socialCardCacheKey(svgContents);
  const cachePath = path.join(socialCardCacheDir, `${cacheKey}.png`);

  if (await fileExists(cachePath)) {
    await copyFile(cachePath, outputPath);
    socialCardStats.cached += 1;
    return outputWebPath(outputPath);
  }

  const sharp = await loadSharpFactory();
  const pngBuffer = await sharp(Buffer.from(svgContents), { density: 144 })
    .png({
      compressionLevel: 9,
      palette: false
    })
    .toBuffer();
  await writeFile(cachePath, pngBuffer);
  await writeFile(outputPath, pngBuffer);
  socialCardStats.generated += 1;
  return outputWebPath(outputPath);
}

async function buildSocialCardManifest(poems, defaultAsOf = "") {
  const routeCards = new Map();
  const shareablePoems = shareablePoemsForDate(poems, defaultAsOf);
  const publishedPoems = publishedPoemsForDate(poems, defaultAsOf);
  const publishedAuthorPages = poetPagesWithPublishedPoems(publishedPoems);
  const staticRouteCards = [
    ["/", "home.png", "A Poem Per Day", "A Poem Per Day"],
    ["/archive", "archive.png", "Archive", "Archive of A Poem Per Day"],
    ["/poets", "poets.png", "Poets", "Poets of A Poem Per Day"],
    ["/about", "about.png", "About", "About A Poem Per Day"]
  ];

  for (const [route, filename, title, alt] of staticRouteCards) {
    const svgContents = renderSocialCardSvg({
      title
    });
    const cardPath = await writeSocialCard(filename, svgContents);
    routeCards.set(route, {
      path: versionedSocialCardPath(cardPath, svgContents),
      alt
    });
  }

  const poemCardEntries = await mapWithConcurrency(shareablePoems, async (poem) => {
    const svgContents = renderSocialCardSvg({
      title: poem.title
    });
    const cardPath = await writeSocialCard(`poem-${poem.date}.png`, svgContents);
    return [poem.route, {
      path: versionedSocialCardPath(cardPath, svgContents),
      alt: poem.title
    }];
  });
  for (const [route, card] of poemCardEntries) {
    routeCards.set(route, card);
  }

  const poetCardEntries = await mapWithConcurrency(publishedAuthorPages, async (poetPage) => {
    const svgContents = renderSocialCardSvg({
      title: poetPage.poet
    });
    const cardPath = await writeSocialCard(`poet-${poetPage.slug}.png`, svgContents);
    return [poetPage.route, {
      path: versionedSocialCardPath(cardPath, svgContents),
      alt: `${poetPage.poet} on A Poem Per Day`
    }];
  });
  for (const [route, card] of poetCardEntries) {
    routeCards.set(route, card);
  }

  return {
    routeCards
  };
}

function renderSharingExtraHead(routePath, { articlePublished = "", articleAuthor = "" } = {}) {
  const card = socialCardManifest?.routeCards?.get(routePath);
  const imageUrl = absoluteAssetUrl(card?.path || "");
  const bits = [];

  if (imageUrl) {
    bits.push(
      `<meta property="og:image" content="${htmlEscape(imageUrl)}">`,
      `<meta property="og:image:url" content="${htmlEscape(imageUrl)}">`,
      `<meta property="og:image:secure_url" content="${htmlEscape(imageUrl)}">`,
      '<meta property="og:image:type" content="image/png">',
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      `<meta property="og:image:alt" content="${htmlEscape(card.alt || "A Poem Per Day")}">`,
      `<meta name="twitter:image" content="${htmlEscape(imageUrl)}">`,
      `<meta name="twitter:image:src" content="${htmlEscape(imageUrl)}">`,
      `<meta name="twitter:image:alt" content="${htmlEscape(card.alt || "A Poem Per Day")}">`
    );
  }

  if (articlePublished) {
    bits.push(`<meta property="article:published_time" content="${htmlEscape(`${articlePublished}T00:00:00Z`)}">`);
  }
  if (articleAuthor) {
    bits.push(`<meta property="article:author" content="${htmlEscape(articleAuthor)}">`);
  }

  return bits.join("\n  ");
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

function plainTextExcerpt(input, maxLength = 220) {
  const normalized = String(input || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).replace(/\s+\S*$/g, "")}\u2026`;
}

function effectivePublicationCutoff(defaultAsOf = "") {
  return defaultAsOf || yyyyMmDdInTimeZone("Europe/Istanbul");
}

function filterPoemsOnOrBefore(poems, cutoffDate) {
  return poems.filter((poem) => poem.date <= cutoffDate);
}

function runtimeDataCutoff(defaultAsOf = "") {
  return runtimeAsOfEnabled
    ? "9999-12-31"
    : addDaysToYyyyMmDd(effectivePublicationCutoff(defaultAsOf), 1);
}

function poemVisibilityState(poem, defaultAsOf = "") {
  const publicationCutoff = effectivePublicationCutoff(defaultAsOf);
  if (poem.date <= publicationCutoff) {
    return "published";
  }
  return poem.date <= runtimeDataCutoff(defaultAsOf) ? "shareable" : "scheduled";
}

function publishedPoemsForDate(poems, defaultAsOf = "") {
  const cutoff = effectivePublicationCutoff(defaultAsOf);
  return filterPoemsOnOrBefore(poems, cutoff);
}

function shareablePoemsForDate(poems, defaultAsOf = "") {
  return filterPoemsOnOrBefore(poems, runtimeDataCutoff(defaultAsOf));
}

function poetPagesWithPublishedPoems(publishedPoems) {
  const publishedAuthors = new Set(publishedPoems.map((poem) => poem.poet));
  return poetPages.filter((entry) => publishedAuthors.has(entry.poet));
}

async function templateModifiedAt(name) {
  return (await cachedStat(path.join(templatesDir, name))).mtime.toISOString();
}

function poemsModifiedAt(poems) {
  return mostRecentIsoTimestamp(poems.map((poem) => poem.sourceModifiedAt));
}

function fontPath(routePath, filename) {
  return routeRelativeAssetUrl(routePath, filename);
}

function fontPreloads(routePath) {
  const { fonts } = requireAssetManifest();
  return [
    `<link rel="preload" href="${fontPath(routePath, fonts.regular400)}" as="font" type="font/woff2" crossorigin>`,
    `<link rel="preload" href="${fontPath(routePath, fonts.bold700)}" as="font" type="font/woff2" crossorigin>`
  ].join("\n  ");
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
      `<span class="poetry-line" style="--poetry-cols: ${segments.length}; --poetry-template: ${template};">${content}</span>`
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
      `<span style="display:inline-grid;width:100%;grid-template-columns:${template};column-gap:0;row-gap:0;align-items:baseline;line-height:inherit;">${content}</span>`
    );
  }

  return transformed.join("\n");
}

function validateCustomMarkdownSyntax(markdown, filename) {
  const lines = String(markdown || "").split("\n");
  let activeFenceChar = "";
  const strict = String(process.env.SEREIN_STRICT_MARKUP || "1") !== "0";

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
      const message = `Invalid ::line syntax in ${filename}:${i + 1}. Expected tokens like |<text| |^text| |>text|, optional text-align prefix (left:, center:, right:), or spacer |~10ch|.`;
      if (strict) {
        throw new Error(message);
      }
      console.warn(`Warning: ${message}`);
    }
  }
}

function renderPoemMarkdown(markdown) {
  const withAlignedLines = withAlignedPoetryLines(markdown);
  return marked.parse(withAlignedLines);
}

function renderRssPoemMarkdown(markdown) {
  const withAlignedLines = withInlineStyledAlignedPoetryLines(markdown);
  return marked.parse(withAlignedLines);
}

function poemUsesCustomMarkup(markdown) {
  const source = String(markdown || "");
  return /(^|\n)\s*::line\b/m.test(source);
}

function renderRssCustomMarkupFallback(link) {
  return `<p>This poem uses special formatting that is not suited for RSS feeds. Please <a href="${htmlEscape(
    link
  )}">visit the website to read it</a>.</p>`;
}

function renderRssItemDescription(poem, usesCustomMarkup) {
  if (usesCustomMarkup) {
    return `${poem.title} by ${poem.poet}. This poem uses special formatting. Visit the website to read it.`;
  }
  return plainTextExcerpt(poem.searchText || markdownStrip(poem.poem));
}

function validatePoem(poem, filename) {
  const required = ["title", "poet", "date", "poem"];

  for (const field of required) {
    if (!poem[field] || typeof poem[field] !== "string") {
      throw new Error(`Missing or invalid field '${field}' in ${filename}`);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(poem.date)) {
    throw new Error(`Invalid date '${poem.date}' in ${filename}. Expected YYYY-MM-DD.`);
  }

  if (typeof poem.publication !== "string") {
    poem.publication = poem.publication == null ? "" : String(poem.publication);
  }
  if (typeof poem.translator !== "string") {
    poem.translator = poem.translator == null ? "" : String(poem.translator);
  }
  if (typeof poem.source !== "string") {
    poem.source = poem.source == null ? "" : String(poem.source);
  }
  if (poem.source) {
    let parsedUrl;
    try {
      parsedUrl = new URL(poem.source);
    } catch {
      throw new Error(`Invalid source URL '${poem.source}' in ${filename}. Expected an absolute http(s) URL.`);
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(`Invalid source URL '${poem.source}' in ${filename}. Expected an absolute http(s) URL.`);
    }
  }
}

function duplicateDateEntries(poems) {
  const byDate = new Map();
  for (const poem of poems) {
    if (!byDate.has(poem.date)) {
      byDate.set(poem.date, []);
    }
    byDate.get(poem.date).push(poem);
  }
  return Array.from(byDate.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([date, matches]) => ({
      date,
      poems: matches.map((poem) => ({
        title: poem.title,
        poet: poem.poet,
        filepath: poem.filepath
      }))
    }));
}

function poemReportSummary(poem) {
  return {
    date: poem.date,
    title: poem.title,
    poet: poem.poet,
    filepath: poem.filepath
  };
}

function poetTalliesForReport(poems, effectiveAsOf) {
  const byPoet = new Map();

  for (const poem of poems) {
    const poet = String(poem.poet || "").trim() || "Unknown";
    if (!byPoet.has(poet)) {
      byPoet.set(poet, {
        poet,
        totalPoems: 0,
        publishedPoems: 0,
        scheduledPoems: 0
      });
    }

    const tally = byPoet.get(poet);
    tally.totalPoems += 1;
    if (poem.date <= effectiveAsOf) {
      tally.publishedPoems += 1;
    } else {
      tally.scheduledPoems += 1;
    }
  }

  return Array.from(byPoet.values()).sort((left, right) => (
    right.totalPoems - left.totalPoems
    || comparePoetsBySurname(left.poet, right.poet)
  ));
}

function gapDaysBetween(leftDate, rightDate) {
  const left = parseDateParts(leftDate);
  const right = parseDateParts(rightDate);
  if (!left || !right) {
    return 0;
  }
  const leftTime = Date.UTC(Number(left.year), Number(left.month) - 1, Number(left.day));
  const rightTime = Date.UTC(Number(right.year), Number(right.month) - 1, Number(right.day));
  return Math.max(0, Math.round((rightTime - leftTime) / 86400000) - 1);
}

export async function loadPoems() {
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
    const sourceStats = await cachedStat(file.fullPath);
    const parsed = parsePoemMarkdownFile(raw, file.relPath);
    validatePoem(parsed, file.relPath);
    validateCustomMarkdownSyntax(parsed.poem, file.relPath);
    const expectedFilename = expectedPoemFilename(parsed);
    if (!expectedFilename) {
      throw new Error(`Could not derive expected filename from date/title in ${file.relPath}.`);
    }
    if (file.name !== expectedFilename) {
      throw new Error(
        `Invalid poem filename '${file.relPath}'. Expected '${expectedFilename}' (based on date + title). Run 'npm run normalize:poems'.`
      );
    }

    const expectedSubdir = expectedPoemSubdirForDate(parsed.date);
    if (!expectedSubdir) {
      throw new Error(`Could not derive expected subdirectory from date in ${file.relPath}.`);
    }
    const actualSubdir = path.dirname(file.relPath);
    if (actualSubdir !== expectedSubdir) {
      throw new Error(
        `Invalid poem path '${file.relPath}'. Expected to be in '${expectedSubdir}'. Run 'npm run normalize:poems'.`
      );
    }

    parsed.filename = file.name;
    parsed.filepath = file.relPath;
    parsed.sourceFullPath = file.fullPath;
    parsed.sourceModifiedAt = sourceStats.mtime.toISOString();
    parsed.route = toRoutePath(parsed.date);
    poems.push(parsed);
  }

  poems.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const duplicates = duplicateDateEntries(poems);
  if (duplicates.length > 0) {
    const lines = duplicates
      .map((entry) => `${entry.date}: ${entry.poems.map((poem) => `${poem.title} (${poem.filepath})`).join(", ")}`)
      .join("; ");
    throw new Error(`Duplicate poem dates are not allowed. ${lines}`);
  }
  return poems;
}

export function preparePoems(poems, poetRouteByName = new Map()) {
  return poems.map((poem) => ({
    ...poem,
    poetRoute: poetRouteByName.get(poem.poet) || "",
    poetMetaHtml: renderPoetMeta({
      ...poem,
      poetRoute: poetRouteByName.get(poem.poet) || ""
    }),
    poemHtml: renderPoemContent(poem),
    searchText: markdownStrip(poem.poem)
  }));
}

function renderFooter(routePath) {
  const prefix = relativePrefix(routePath);
  const links = [];
  if (routePath !== "/") {
    links.push(`<a href="${prefix}" data-prefetch="eager">Today</a>`);
  }
  links.push(`<a href="${prefix}archive/" data-prefetch="eager">Archive</a>`);
  links.push(`<a href="${prefix}about/" data-prefetch="eager">About</a>`);
  return `<footer class="site-footer"><nav class="site-footer-nav" aria-label="Footer">${links.join('<span aria-hidden="true" class="separator-mark site-footer-separator">&bull;</span>')}</nav></footer>`;
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
    return `<a href="${htmlEscape(source)}" target="_blank" rel="noreferrer">Link</a>`;
  }
  return `${publication}<span aria-hidden="true" class="separator-mark meta-separator">&middot;</span><a href="${htmlEscape(source)}" target="_blank" rel="noreferrer">Link</a>`;
}

function renderTranslatorMeta(poem) {
  const translator = htmlEscape(poem.translator || "");
  return translator || "";
}

function renderPoetMeta(poem) {
  const poetName = htmlEscape(poem.poet || "");
  const poet = poem.poetRoute ? routeLink(poem.poetRoute, poem.poet || "") : poetName;
  const parts = [
    '<span class="poem-meta-label poem-meta-label-poet">By</span>',
    `<span class="poem-meta-value poem-meta-value-poet">${poet}</span>`
  ];
  const translator = renderTranslatorMeta(poem);
  if (translator) {
    parts.push(
      '<span aria-hidden="true" class="separator-mark poem-meta-separator">&#8729;</span>',
      '<span class="poem-meta-label poem-meta-label-translator">Tr.</span>',
      `<span class="poem-meta-value poem-meta-value-translator">${translator}</span>`
    );
  }
  return `<span class="poem-meta-block">${parts.join("")}</span>`;
}

function withCommonPageAssets(template, routePath, { scriptName = "", robotsMeta = "", twitterCard = "summary", socialMeta = "", headExtra = "" } = {}) {
  let html = template
    .replace("{{ASSET_PATH}}", assetPath(routePath))
    .replace("{{FONT_PRELOADS}}", fontPreloads(routePath))
    .replace("{{MANIFEST_PATH}}", manifestPath(routePath))
    .replace("{{RSS_PATH}}", rssPath(routePath))
    .replace("{{FAVICON_32_PATH}}", favicon32Path(routePath))
    .replace("{{FAVICON_512_PATH}}", favicon512Path(routePath))
    .replace("{{APPLE_TOUCH_ICON_PATH}}", appleTouchPath(routePath))
    .replace("{{CANONICAL_TAG}}", canonicalTag(routePath))
    .replace("{{OG_URL_TAG}}", ogUrlTag(routePath))
    .replace("{{TWITTER_CARD}}", twitterCard)
    .replace("{{SOCIAL_META}}", socialMeta)
    .replace("{{HEAD_EXTRA}}", headExtra)
    .replace("{{FOOTER}}", renderFooter(routePath));

  if (scriptName) {
    html = html.replace("{{SCRIPT_PATH}}", scriptPath(routePath, scriptName));
  }

  if (html.includes("{{ROBOTS_META}}")) {
    html = html.replace("{{ROBOTS_META}}", robotsMeta);
  }

  return html;
}

function sharingOptions(routePath, options = {}) {
  const card = socialCardManifest?.routeCards?.get(routePath);
  const hasImage = Boolean(absoluteAssetUrl(card?.path || ""));
  return {
    twitterCard: hasImage ? "summary_large_image" : "summary",
    socialMeta: renderSharingExtraHead(routePath, options)
  };
}

function poemMetaDescription(poem) {
  const excerpt = plainTextExcerpt(poem.searchText || markdownStrip(poem.poem), 140);
  return excerpt ? `${poem.title} by ${poem.poet}. ${excerpt}` : `${poem.title} by ${poem.poet}.`;
}

const blockedPoemTitle = "Not Available Yet";
const blockedPoemDescription = "This poem is not available yet.";

function renderBlockedPoemContent() {
  return '<p>This poem will become available in <strong id="future-availability-countdown">--</strong> in your local time.</p>';
}

function renderWebsiteStructuredData() {
  if (!siteUrl) {
    return "";
  }

  return jsonLdScript({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "A Poem Per Day",
    url: `${siteUrl}/`
  });
}

function renderPoemStructuredData(poem, routePath) {
  const url = absoluteRouteUrl(routePath);
  const poetUrl = absoluteRouteUrl(poem.poetRoute);
  const author = {
    "@type": "Person",
    name: poem.poet
  };

  if (poetUrl) {
    author.url = poetUrl;
  }

  const data = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: poem.title,
    author,
    description: poemMetaDescription(poem),
    datePublished: poem.date,
    dateModified: poem.sourceModifiedAt || poem.date
  };

  if (poem.translator) {
    data.contributor = {
      "@type": "Person",
      name: poem.translator
    };
  }

  if (url) {
    data.url = url;
    data.mainEntityOfPage = {
      "@type": "WebPage",
      "@id": url
    };
  }

  if (siteUrl) {
    data.isPartOf = {
      "@type": "WebSite",
      name: "A Poem Per Day",
      url: `${siteUrl}/`
    };
  }

  return jsonLdScript(data);
}

function renderPoetStructuredData(poetPage, poemCount = 0) {
  const url = absoluteRouteUrl(poetPage.route);
  if (!url) {
    return "";
  }

  const data = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url,
    name: `${poetPage.poet} | A Poem Per Day`,
    description: poemCount > 0
      ? `Poems by ${poetPage.poet} published on A Poem Per Day.`
      : `${poetPage.poet} on A Poem Per Day.`,
    mainEntity: {
      "@type": "Person",
      name: poetPage.poet,
      url
    }
  };

  if (siteUrl) {
    data.isPartOf = {
      "@type": "WebSite",
      name: "A Poem Per Day",
      url: `${siteUrl}/`
    };
  }

  return jsonLdScript(data);
}

async function renderPoemPageData(poem) {
  if (poemPageDataCache.has(poem.date)) {
    return poemPageDataCache.get(poem.date);
  }

  const assetPath = await writeFingerprintedAsset({
    name: `poem-data-${poem.date}`,
    extension: ".json",
    subdir: "assets/data/poems",
    contents: JSON.stringify({
      title: poem.title,
      poet: poem.poet,
      description: poemMetaDescription(poem),
      dateHtml: renderDateMeta(poem),
      shareHtml: renderShareAction(poem, { routePath: poem.route }),
      poetMetaHtml: renderPoetMeta(poem),
      poemHtml: poem.poemHtml || renderPoemContent(poem)
    })
  });
  poemPageDataCache.set(poem.date, assetPath);
  return assetPath;
}

function homePoemPayload(poem) {
  return {
    date: poem.date,
    title: poem.title,
    dateHtml: renderDateMeta(poem),
    shareHtml: renderShareAction(poem, { routePath: poem.route }),
    poetMetaHtml: renderPoetMeta(poem),
    poemHtml: poem.poemHtml || renderPoemContent(poem)
  };
}

async function renderHomePoemData(poem) {
  if (homePoemDataCache.has(poem.date)) {
    return homePoemDataCache.get(poem.date);
  }

  const assetPath = await writeFingerprintedAsset({
    name: `home-poem-data-${poem.date}`,
    extension: ".json",
    subdir: "assets/data/home",
    contents: JSON.stringify(homePoemPayload(poem))
  });
  homePoemDataCache.set(poem.date, assetPath);
  return assetPath;
}

function renderPoemShell(template, poem, { visibilityState = "published", routePath = "/", defaultAsOf = "", pageDataUrl = "", firstPoemDate = "" } = {}) {
  const blocked = visibilityState === "scheduled";
  const description = blocked ? blockedPoemDescription : poemMetaDescription(poem);
  const poetMeta = blocked ? "" : renderPoetMeta(poem);
  const poemHtml = blocked
    ? renderBlockedPoemContent()
    : (poem.poemHtml || renderPoemContent(poem));
  const structuredData = blocked ? "" : renderPoemStructuredData(poem, routePath);
  const robotsContent = visibilityState === "published"
    ? "index, follow"
    : visibilityState === "shareable"
      ? "noindex, follow"
      : "noindex, nofollow";
  const dateMeta = renderDateMeta(poem);
  const shareMeta = blocked ? "" : renderShareAction(poem, { routePath });
  return withCommonPageAssets(template, routePath, {
    scriptName: "poem",
    robotsMeta: `<meta name="robots" content="${robotsContent}">`,
    headExtra: structuredData,
    ...(blocked
      ? sharingOptions(routePath)
      : sharingOptions(routePath, {
          articlePublished: poem.date,
          articleAuthor: absoluteRouteUrl(poem.poetRoute) || poem.poet
        }))
  })
    .replaceAll("{{TITLE}}", htmlEscape(blocked ? blockedPoemTitle : poem.title))
    .replaceAll("{{POET}}", htmlEscape(blocked ? "" : poem.poet))
    .replaceAll("{{DESCRIPTION}}", htmlEscape(description))
    .replaceAll("{{DATE}}", htmlEscape(poem.date))
    .replaceAll("{{FIRST_POEM_DATE}}", htmlEscape(firstPoemDate))
    .replaceAll("{{DATE_META}}", dateMeta)
    .replaceAll("{{SHARE_META}}", shareMeta)
    .replaceAll("{{DEFAULT_AS_OF}}", htmlEscape(defaultAsOf))
    .replace("{{RUNTIME_AS_OF_ENABLED}}", runtimeAsOfDataValue())
    .replace("{{POEM_BLOCKED}}", blocked ? "1" : "0")
    .replace("{{PAGE_DATA_URL}}", pageDataUrl ? routeRelativeAssetUrl(routePath, pageDataUrl) : "")
    .replaceAll("{{POET_META}}", poetMeta)
    .replaceAll("{{POEM_TEXT}}", poemHtml);
}

async function writeRoutedPage(routePath, html) {
  const finalHtml = await minifyPageHtml(html);
  if (routePath === "/") {
    await writeFile(path.join(distDir, "index.html"), finalHtml, "utf8");
    return;
  }

  const rel = routePath.slice(1);
  const dirPath = path.join(distDir, rel);
  await mkdir(dirPath, { recursive: true });
  await writeFile(path.join(dirPath, "index.html"), finalHtml, "utf8");
}

async function copyRoutedFile(routePath, sourcePath) {
  if (!routePath || routePath === "/") {
    throw new Error(`Invalid routed file path '${routePath}'.`);
  }

  const outputPath = path.join(distDir, ...routePath.slice(1).split("/"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await copyFile(sourcePath, outputPath);
}

async function renderPoemPages(publishedPoems, defaultAsOf = "") {
  const template = await readTemplate("poem.html");
  const clientDataCutoff = runtimeDataCutoff(defaultAsOf);
  const firstPoemDate = publishedPoems[0]?.date || "";

  for (const poem of publishedPoems) {
    const visibilityState = poemVisibilityState(poem, defaultAsOf);
    const blocked = visibilityState === "scheduled";
    const pageDataUrl = blocked && poem.date <= clientDataCutoff
      ? await renderPoemPageData(poem)
      : "";
    const html = renderPoemShell(template, poem, {
      visibilityState,
      routePath: poem.route,
      defaultAsOf,
      pageDataUrl,
      firstPoemDate
    });
    await writeRoutedPage(poem.route, html);
  }
}

async function renderPublishedPoemMarkdownFiles(poems, defaultAsOf = "") {
  const publishedPoems = publishedPoemsForDate(poems, defaultAsOf);

  await mapWithConcurrency(publishedPoems, async (poem) => {
    if (!poem.sourceFullPath) {
      return;
    }
    await copyRoutedFile(`${poem.route}.md`, poem.sourceFullPath);
  });
}

async function renderArchive(poems, defaultAsOf = "") {
  const template = await readTemplate("archive.html");
  const fallbackDate = effectivePublicationCutoff(defaultAsOf);
  const fallbackPoems = filterPoemsOnOrBefore(poems, fallbackDate);
  const rows = renderArchiveTree(fallbackPoems, fallbackDate);
  const html = withCommonPageAssets(template, "/archive", {
    scriptName: "archive",
    robotsMeta: '<meta name="robots" content="index, follow">',
    ...sharingOptions("/archive")
  })
    .replaceAll("{{DEFAULT_AS_OF}}", htmlEscape(defaultAsOf))
    .replaceAll("{{RENDERED_AS_OF}}", htmlEscape(fallbackDate))
    .replace("{{RUNTIME_AS_OF_ENABLED}}", runtimeAsOfDataValue())
    .replace("{{FALLBACK_ARCHIVE_ROWS}}", rows)
    .replace("{{PAGE_DATA_URL}}", pageDataPath("/archive", "archive"));

  await writeRoutedPage("/archive", html);
}

async function renderAbout() {
  const template = await readTemplate("about.html");
  const html = withCommonPageAssets(template, "/about", {
    scriptName: "about",
    ...sharingOptions("/about")
  }).replace("{{RUNTIME_AS_OF_ENABLED}}", runtimeAsOfDataValue());
  await writeRoutedPage("/about", html);
}

async function renderHome(poems, defaultAsOf = "") {
  const template = await readTemplate("index.html");
  const fallbackDate = effectivePublicationCutoff(defaultAsOf);
  const fallbackPoems = filterPoemsOnOrBefore(poems, fallbackDate);
  const fallbackPoem = fallbackPoems.find((poem) => poem.date === fallbackDate) || fallbackPoems[fallbackPoems.length - 1] || null;
  const firstPoemDate = poems[0]?.date || "";
  const fallbackDateHtml = fallbackPoem ? renderDateMeta(fallbackPoem) : "";
  const fallbackShareHtml = fallbackPoem ? renderShareAction(fallbackPoem, { routePath: fallbackPoem.route }) : "";
  const fallbackTitle = fallbackPoem ? htmlEscape(fallbackPoem.title) : "A Poem Per Day";
  const fallbackMeta = fallbackPoem ? fallbackPoem.poetMetaHtml || renderPoetMeta(fallbackPoem) : "";
  const fallbackDescription = "A new poem every day, published at midnight in your local time.";
  const fallbackBody = fallbackPoem
    ? fallbackPoem.poemHtml || renderPoemContent(fallbackPoem)
    : '<p class="empty">No poem is published for today.</p>';
  const html = withCommonPageAssets(template, "/", {
    scriptName: "home",
    robotsMeta: '<meta name="robots" content="index, follow">',
    headExtra: renderWebsiteStructuredData(),
    ...sharingOptions("/")
  })
    .replaceAll("{{PAGE_TITLE}}", "A Poem Per Day")
    .replaceAll("{{PAGE_DESCRIPTION}}", htmlEscape(fallbackDescription))
    .replaceAll("{{DEFAULT_AS_OF}}", htmlEscape(defaultAsOf))
    .replaceAll("{{RENDERED_AS_OF}}", htmlEscape(fallbackDate))
    .replace("{{RUNTIME_AS_OF_ENABLED}}", runtimeAsOfDataValue())
    .replace("{{FALLBACK_POEM_DATE}}", htmlEscape(fallbackPoem?.date || ""))
    .replace("{{FIRST_POEM_DATE}}", htmlEscape(firstPoemDate))
    .replace("{{FALLBACK_DATE_HTML}}", fallbackDateHtml)
    .replace("{{FALLBACK_SHARE_HTML}}", fallbackShareHtml)
    .replace("{{FALLBACK_TITLE}}", fallbackTitle)
    .replace("{{FALLBACK_META}}", fallbackMeta)
    .replace("{{FALLBACK_POEM_HTML}}", fallbackBody)
    .replace("{{PAGE_DATA_URL}}", pageDataPath("/", "home"));

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

function displayDateLabel(yyyyMmDd) {
  const parts = parseDateParts(yyyyMmDd);
  if (!parts) {
    return String(yyyyMmDd || "");
  }
  const dt = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(dt);
}

function renderDateMeta(poem) {
  const date = String(poem.date || "").trim();
  if (!date) {
    return "";
  }
  return `<time datetime="${htmlEscape(date)}">${htmlEscape(displayDateLabel(date))}</time>`;
}

function renderShareAction(poem, { routePath = "" } = {}) {
  if (!routePath) {
    return "";
  }
  const href = routeHref(routePath);
  const title = String(poem.title || "").trim() || "A Poem Per Day";
  return `<a class="poem-share-action" href="${htmlEscape(href)}" data-share-link="1" data-share-title="${htmlEscape(title)}">Share</a>`;
}

function renderArchiveRow(poem, fromRoute) {
  const href = `${relativePrefix(fromRoute)}${poem.route.slice(1)}/`;
  const parts = parseDateParts(poem.date);
  const day = parts ? parts.day : "--";
  return `<li><span class="archive-day">${htmlEscape(day)}</span><span aria-hidden="true" class="separator-mark">&middot;</span><a href="${htmlEscape(href)}">${htmlEscape(poem.title)}</a></li>`;
}

const poetCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function normalizedAlphaText(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function poetSortParts(poet) {
  const normalized = normalizedAlphaText(poet);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { initialSource: "", primary: "", secondary: "" };
  }

  const primary = tokens[tokens.length - 1];
  const secondary = tokens.slice(0, -1).join(" ");
  return {
    initialSource: primary,
    primary,
    secondary
  };
}

function poetIndexLabel(poet) {
  const raw = String(poet || "").trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) {
    return raw;
  }
  const primary = tokens[tokens.length - 1];
  const secondary = tokens.slice(0, -1).join(" ");
  return `${primary}, ${secondary}`;
}

function comparePoetsBySurname(left, right) {
  const leftParts = poetSortParts(left);
  const rightParts = poetSortParts(right);
  return (
    poetCollator.compare(leftParts.primary, rightParts.primary)
    || poetCollator.compare(leftParts.secondary, rightParts.secondary)
    || poetCollator.compare(left, right)
  );
}

function comparePoemsByDateDesc(left, right) {
  return right.date.localeCompare(left.date) || left.title.localeCompare(right.title);
}

function sortDesc(values) {
  return Array.from(values).sort((left, right) => right.localeCompare(left));
}

function sortMapKeysDesc(map) {
  return sortDesc(map.keys());
}

async function mapWithConcurrency(items, mapper, concurrency = BACKGROUND_TASK_CONCURRENCY) {
  const list = Array.from(items);
  if (list.length === 0) {
    return [];
  }

  const results = new Array(list.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), list.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      if (currentIndex >= list.length) {
        return;
      }
      nextIndex += 1;
      results[currentIndex] = await mapper(list[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

function poetInitial(poet) {
  const { initialSource } = poetSortParts(poet);
  const firstChar = initialSource.charAt(0).toUpperCase();
  return /^[A-Z]$/.test(firstChar) ? firstChar : "#";
}

function comparePoetInitials(left, right) {
  if (left === "#") {
    return 1;
  }
  if (right === "#") {
    return -1;
  }
  return poetCollator.compare(left, right);
}

function sortPoetInitials(values) {
  return Array.from(values).sort(comparePoetInitials);
}

function sortPoetsBySurname(values) {
  return Array.from(values).sort(comparePoetsBySurname);
}

function slugifySegment(input) {
  const base = normalizedAlphaText(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "unknown";
}

export function buildPoetPages(poems) {
  const poemsByPoet = new Map();
  for (const poem of poems) {
    const poet = String(poem.poet || "").trim() || "Unknown";
    if (!poemsByPoet.has(poet)) {
      poemsByPoet.set(poet, []);
    }
    poemsByPoet.get(poet).push(poem);
  }

  const poets = sortPoetsBySurname(poemsByPoet.keys());
  const slugCounts = new Map();

  return poets.map((poet) => {
    const baseSlug = slugifySegment(poet);
    const nextCount = (slugCounts.get(baseSlug) || 0) + 1;
    slugCounts.set(baseSlug, nextCount);
    const slug = nextCount === 1 ? baseSlug : `${baseSlug}-${nextCount}`;
    const route = `/poets/${slug}`;
    const poetPoems = poemsByPoet
      .get(poet)
      .slice()
      .sort(comparePoemsByDateDesc);

    return {
      poet,
      slug,
      route,
      poems: poetPoems
    };
  });
}

function poetRouteMap(poetPagesList) {
  return new Map(poetPagesList.map((entry) => [entry.poet, entry.route]));
}

function groupPoetPagesByInitial(poetPagesList) {
  const groups = new Map();
  const sorted = poetPagesList
    .slice()
    .sort((left, right) => comparePoetsBySurname(left.poet, right.poet));

  for (const poetPage of sorted) {
    const initial = poetInitial(poetPage.poet);
    if (!groups.has(initial)) {
      groups.set(initial, []);
    }
    groups.get(initial).push(poetPage);
  }

  return groups;
}

function groupPoemsByYearMonth(publishedPoems) {
  const groups = new Map();

  for (const poem of publishedPoems.slice().sort(comparePoemsByDateDesc)) {
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

function renderArchiveTree(publishedPoems, today, fromRoute = "/archive") {
  const todayParts = parseDateParts(today);
  const currentYear = todayParts?.year || "";
  const currentMonth = todayParts?.month || "";
  const grouped = groupPoemsByYearMonth(publishedPoems);
  const years = sortMapKeysDesc(grouped);

  if (years.length === 0) {
    return "<p>No published poems yet.</p>";
  }

  return years
    .map((year) => {
      const monthsMap = grouped.get(year);
      const months = sortMapKeysDesc(monthsMap);
      const yearOpen = year === currentYear ? " open" : "";
      const defaultOpenMonth = year === currentYear ? (months.includes(currentMonth) ? currentMonth : months[0] || "") : "";
      const monthBlocks = months
        .map((month) => {
          const poems = monthsMap.get(month);
          const monthOpen = year === currentYear && month === defaultOpenMonth ? " open" : "";
          const rows = poems.map((poem) => renderArchiveRow(poem, fromRoute)).join("");
          return `<details class="archive-month"${monthOpen}><summary>${htmlEscape(monthLabel(month))}</summary><ul class="archive-poems">${rows}</ul></details>`;
        })
        .join("");
      return `<details class="archive-year"${yearOpen}><summary>${htmlEscape(year)}</summary><div class="archive-months">${monthBlocks}</div></details>`;
    })
    .join("");
}

function renderPoetsTree(poetPagesList) {
  const grouped = groupPoetPagesByInitial(poetPagesList);
  const letters = sortPoetInitials(grouped.keys());

  if (letters.length === 0) {
    return "<p>No published poets yet.</p>";
  }

  return letters
    .map((letter) => {
      const poetPagesForLetter = grouped.get(letter);
      const poetBlocks = poetPagesForLetter
        .map((poetPage) => {
          const label = poetIndexLabel(poetPage.poet);
          const poetLabel = poetPage.route
            ? routeLink(poetPage.route, label)
            : htmlEscape(label);
          return `<li class="poet-authors-item">${poetLabel}</li>`;
        })
        .join("");

      return `<details class="archive-year poet-letter"><summary>${htmlEscape(letter)}</summary><div class="archive-months poet-groups"><ul class="poet-authors">${poetBlocks}</ul></div></details>`;
    })
    .join("");
}

async function renderPoets(poems, defaultAsOf = "") {
  const template = await readTemplate("poets.html");
  const fallbackDate = effectivePublicationCutoff(defaultAsOf);
  const fallbackPoems = filterPoemsOnOrBefore(poems, fallbackDate);
  const rows = renderPoetsTree(poetPagesWithPublishedPoems(fallbackPoems));
  const html = withCommonPageAssets(template, "/poets", {
    scriptName: "poets",
    robotsMeta: '<meta name="robots" content="index, follow">',
    ...sharingOptions("/poets")
  })
    .replaceAll("{{DEFAULT_AS_OF}}", htmlEscape(defaultAsOf))
    .replaceAll("{{RENDERED_AS_OF}}", htmlEscape(fallbackDate))
    .replace("{{RUNTIME_AS_OF_ENABLED}}", runtimeAsOfDataValue())
    .replace("{{FALLBACK_POET_ROWS}}", rows)
    .replace("{{PAGE_DATA_URL}}", pageDataPath("/poets", "poets"));

  await writeRoutedPage("/poets", html);
}

function poetCountNoun(count) {
  return count === 1 ? "poem" : "poems";
}

function poetMetaLabel(_poet, count) {
  if (count === 0) {
    return "has no published poems";
  }
  return `has ${count} published ${poetCountNoun(count)}`;
}

async function renderPoetPages(poems, defaultAsOf = "") {
  const template = await readTemplate("poet.html");
  const fallbackDate = effectivePublicationCutoff(defaultAsOf);

  for (const poetPage of poetPages) {
    const fallbackPoems = filterPoemsOnOrBefore(poetPage.poems, fallbackDate);
    const rows = fallbackPoems.length > 0
      ? renderArchiveTree(fallbackPoems, fallbackDate, poetPage.route)
      : `<p>No published poems by ${htmlEscape(poetPage.poet)} yet.</p>`;
    const description = poetMetaLabel(poetPage.poet, fallbackPoems.length);
    const html = withCommonPageAssets(template, poetPage.route, {
      scriptName: "poetPage",
      robotsMeta: fallbackPoems.length > 0
        ? '<meta name="robots" content="index, follow">'
        : '<meta name="robots" content="noindex, nofollow">',
      headExtra: fallbackPoems.length > 0 ? renderPoetStructuredData(poetPage, fallbackPoems.length) : "",
      ...sharingOptions(poetPage.route)
    })
      .replaceAll("{{POET}}", htmlEscape(poetPage.poet))
      .replaceAll("{{PAGE_DESCRIPTION}}", htmlEscape(description))
      .replaceAll("{{DEFAULT_AS_OF}}", htmlEscape(defaultAsOf))
      .replaceAll("{{RENDERED_AS_OF}}", htmlEscape(fallbackDate))
      .replace("{{RUNTIME_AS_OF_ENABLED}}", runtimeAsOfDataValue())
      .replace("{{POET_ROUTE}}", htmlEscape(poetPage.route))
      .replace("{{FALLBACK_POEMS}}", rows)
      .replace("{{PAGE_DATA_URL}}", poetPageDataPath(poetPage.route));

    await writeRoutedPage(poetPage.route, html);
  }
}

function renderPublicationNote(poem) {
  const publicationMeta = renderPublicationMeta(poem);
  if (!publicationMeta) {
    return "";
  }
  return `<p class="publication-note"><span class="publication-label">Source: </span>${publicationMeta}</p>`;
}

function renderPoemContent(poem, { includePublicationNote = true } = {}) {
  const poemHtml = renderPoemMarkdown(poem.poem);
  if (!includePublicationNote) {
    return poemHtml;
  }
  const publicationNote = renderPublicationNote(poem);
  return publicationNote ? `${poemHtml}${publicationNote}` : poemHtml;
}

async function renderHomeData(poems, defaultAsOf = "") {
  const publicationCutoff = effectivePublicationCutoff(defaultAsOf);
  const clientDataCutoff = runtimeDataCutoff(defaultAsOf);
  const visiblePoems = runtimeAsOfEnabled
    ? poems
    : filterPoemsOnOrBefore(poems, publicationCutoff);
  const recentVisiblePoems = runtimeAsOfEnabled
    ? []
    : visiblePoems.slice(-2);
  const upcomingPoems = runtimeAsOfEnabled
    ? []
    : poems.filter((poem) => poem.date > publicationCutoff && poem.date <= clientDataCutoff);
  const home = {
    poems: runtimeAsOfEnabled
      ? await mapWithConcurrency(visiblePoems, async (poem) => ({
        date: poem.date,
        pageDataUrl: await renderHomePoemData(poem)
      }))
      : recentVisiblePoems.map((poem) => ({
        date: poem.date,
        ...homePoemPayload(poem)
      })),
    upcoming: await mapWithConcurrency(upcomingPoems, async (poem) => ({
      date: poem.date,
      pageDataUrl: await renderHomePoemData(poem)
    }))
  };

  return writeFingerprintedAsset({
    name: "home-data",
    extension: ".json",
    subdir: "assets/data",
    contents: JSON.stringify(home)
  });
}

async function renderArchiveData(poems, defaultAsOf = "") {
  const cutoff = runtimeDataCutoff(defaultAsOf);
  const archive = filterPoemsOnOrBefore(poems, cutoff)
    .map((poem) => ({
      title: poem.title,
      date: poem.date,
      route: poem.route
    }));

  return writeFingerprintedAsset({
    name: "archive-data",
    extension: ".json",
    subdir: "assets/data",
    contents: JSON.stringify(archive)
  });
}

async function renderPoetsData(poems, defaultAsOf = "") {
  const cutoff = runtimeDataCutoff(defaultAsOf);
  const poets = filterPoemsOnOrBefore(poems, cutoff)
    .map((poem) => ({
      title: poem.title,
      poet: poem.poet,
      poetRoute: poem.poetRoute,
      date: poem.date,
      route: poem.route
    }));

  return writeFingerprintedAsset({
    name: "poets-data",
    extension: ".json",
    subdir: "assets/data",
    contents: JSON.stringify(poets)
  });
}

async function renderPoetPageDataAssets(poetPagesList, defaultAsOf = "") {
  const cutoff = runtimeDataCutoff(defaultAsOf);
  const entries = await mapWithConcurrency(poetPagesList, async (poetPage) => {
    const poems = filterPoemsOnOrBefore(poetPage.poems, cutoff)
      .map((poem) => ({
        title: poem.title,
        date: poem.date,
        route: poem.route
      }));
    if (poems.length === 0) {
      return null;
    }
    const assetPath = await writeFingerprintedAsset({
      name: `poet-page-data-${poetPage.slug}`,
      extension: ".json",
      subdir: "assets/data/poets",
      contents: JSON.stringify(poems)
    });
    return [poetPage.route, assetPath];
  });

  return Object.fromEntries(entries.filter(Boolean));
}

async function buildBundledAssetManifest() {
  const bundle = await loadEsbuildBundle();
  const result = await bundle({
    absWorkingDir: root,
    assetNames: "[name]-[hash]",
    bundle: true,
    charset: "utf8",
    entryNames: "[name]-[hash]",
    entryPoints: bundledAssetEntries,
    format: "iife",
    legalComments: "none",
    loader: {
      ".svg": "file",
      ".woff2": "file"
    },
    metafile: true,
    minify: true,
    outdir: path.join(distDir, "assets"),
    platform: "browser",
    target: ["es2020"],
    write: true
  });

  const metafile = result.metafile || { outputs: {} };
  const manifest = {
    css: bundledOutputByEntry(metafile, bundledAssetEntries.styles),
    scripts: {
      home: bundledOutputByEntry(metafile, bundledAssetEntries.home),
      archive: bundledOutputByEntry(metafile, bundledAssetEntries.archive),
      poets: bundledOutputByEntry(metafile, bundledAssetEntries.poets),
      poetPage: bundledOutputByEntry(metafile, bundledAssetEntries.poetPage),
      about: bundledOutputByEntry(metafile, bundledAssetEntries.about),
      poem: bundledOutputByEntry(metafile, bundledAssetEntries.poem)
    },
    fonts: {
      regular400: bundledOutputByInput(metafile, fontSourceEntries.regular400),
      bold700: bundledOutputByInput(metafile, fontSourceEntries.bold700)
    }
  };

  const requiredOutputs = [
    manifest.css,
    manifest.scripts.home,
    manifest.scripts.archive,
    manifest.scripts.poets,
    manifest.scripts.poetPage,
    manifest.scripts.about,
    manifest.scripts.poem,
    manifest.fonts.regular400,
    manifest.fonts.bold700
  ];

  if (requiredOutputs.some((value) => !value)) {
    throw new Error("Missing one or more bundled asset outputs.");
  }

  return manifest;
}

async function buildAssetManifest(poems, defaultAsOf = "") {
  const [bundledAssets, homeData, archiveData, poetsData, poetPageData, circle32, circle192, circle512, ios180] = await Promise.all([
    buildBundledAssetManifest(),
    renderHomeData(poems, defaultAsOf),
    renderArchiveData(poems, defaultAsOf),
    renderPoetsData(poems, defaultAsOf),
    renderPoetPageDataAssets(poetPages, defaultAsOf),
    copyFingerprintedAsset(iconSourceEntries.circle32, { subdir: "assets/branding" }),
    copyFingerprintedAsset(iconSourceEntries.circle192, { subdir: "assets/branding" }),
    copyFingerprintedAsset(iconSourceEntries.circle512, { subdir: "assets/branding" }),
    copyFingerprintedAsset(iconSourceEntries.ios180, { subdir: "assets/branding" })
  ]);

  await copyFile(iconSourceEntries.faviconIco, path.join(distDir, "favicon.ico"));

  const manifestSource = JSON.parse(await readFile(path.join(assetsDir, "site.webmanifest"), "utf8"));
  manifestSource.icons = [
    {
      src: circle192,
      sizes: "192x192",
      type: "image/png"
    },
    {
      src: circle512,
      sizes: "512x512",
      type: "image/png"
    }
  ];

  const manifestFile = await writeFingerprintedAsset({
    name: "site",
    extension: ".webmanifest",
    subdir: "assets",
    contents: JSON.stringify(manifestSource)
  });

  return {
    ...bundledAssets,
    data: {
      home: homeData,
      archive: archiveData,
      poets: poetsData
    },
    poetPages: poetPageData,
    icons: {
      circle32,
      circle192,
      circle512,
      ios180
    },
    manifest: manifestFile
  };
}

async function renderHeadersFile() {
  const headers = `/assets/*
  Cache-Control: public, max-age=31536000, immutable

/*.md
  Content-Type: text/markdown; charset=utf-8
  X-Content-Type-Options: nosniff
  X-Robots-Tag: noindex, nofollow

/*
  Cache-Control: public, max-age=0, must-revalidate
`;
  await writeFile(path.join(distDir, "_headers"), headers, "utf8");
}

export async function createEditorialReport(poems, { asOfDate = "", poetPagesList = poetPages } = {}) {
  const effectiveAsOf = asOfDate || yyyyMmDdInTimeZone("Europe/Istanbul");
  const publishedPoems = [];
  const upcomingPoems = [];
  const missingPublication = [];
  const missingSource = [];
  const customMarkup = [];
  const duplicatePoems = duplicatePoemGroups(poems);
  const poetTallies = poetTalliesForReport(poems, effectiveAsOf);

  for (const poem of poems) {
    const summary = poemReportSummary(poem);
    if (poem.date <= effectiveAsOf) {
      publishedPoems.push(poem);
    } else {
      upcomingPoems.push(poem);
    }

    if (!String(poem.publication || "").trim()) {
      missingPublication.push(summary);
    }
    if (!String(poem.source || "").trim()) {
      missingSource.push(summary);
    }
    if (poemUsesCustomMarkup(poem.poem)) {
      customMarkup.push(summary);
    }
  }

  const scheduleGaps = [];
  for (let index = 1; index < poems.length; index += 1) {
    const previous = poems[index - 1];
    const current = poems[index];
    const missingDays = gapDaysBetween(previous.date, current.date);
    if (missingDays > 0) {
      scheduleGaps.push({
        after: previous.date,
        before: current.date,
        missingDays
      });
    }
  }

  const publishedPoetCount = poetTallies.filter((item) => item.publishedPoems > 0).length;

  return {
    generatedAt: new Date().toISOString(),
    asOfDate: effectiveAsOf,
    totals: {
      poems: poems.length,
      publishedPoems: publishedPoems.length,
      upcomingPoems: upcomingPoems.length,
      poets: poetTallies.length || poetPagesList.length,
      publishedPoets: publishedPoetCount,
      missingPublication: missingPublication.length,
      missingSource: missingSource.length,
      customMarkup: customMarkup.length,
      duplicatePoems: duplicatePoems.length
    },
    upcomingPoems: upcomingPoems.map((poem) => ({
      date: poem.date,
      title: poem.title,
      poet: poem.poet,
      filepath: poem.filepath
    })),
    scheduleGaps,
    missingPublication,
    missingSource,
    customMarkup,
    duplicatePoems,
    poetTallies
  };
}

export function formatEditorialReportText(report) {
  const lines = [
    "Serein editorial report",
    `Generated: ${report.generatedAt}`,
    `As of: ${report.asOfDate}`,
    "",
    "Totals",
    `- Poems: ${report.totals.poems}`,
    `- Published poems: ${report.totals.publishedPoems}`,
    `- Upcoming poems: ${report.totals.upcomingPoems}`,
    `- Poets: ${report.totals.poets}`,
    `- Published poets: ${report.totals.publishedPoets}`,
    `- Missing publication fields: ${report.totals.missingPublication}`,
    `- Missing source fields: ${report.totals.missingSource}`,
    `- Duplicate poem groups: ${report.totals.duplicatePoems}`,
    `- Poems using custom markup: ${report.totals.customMarkup}`,
    "",
    "Schedule gaps"
  ];

  if (report.scheduleGaps.length === 0) {
    lines.push("- None");
  } else {
    for (const gap of report.scheduleGaps) {
      lines.push(`- ${gap.after} -> ${gap.before}: ${gap.missingDays} missing day(s)`);
    }
  }

  lines.push("", "Duplicate poems");
  if (report.duplicatePoems.length === 0) {
    lines.push("- None");
  } else {
    for (const group of report.duplicatePoems) {
      lines.push(`- ${group.title} by ${group.poet}: ${group.count} entries`);
      for (const poem of group.poems) {
        lines.push(`  ${poem.date}: ${poem.filepath}`);
      }
    }
  }

  lines.push("", "Upcoming poems");
  if (report.upcomingPoems.length === 0) {
    lines.push("- None");
  } else {
    for (const poem of report.upcomingPoems) {
      lines.push(`- ${poem.date}: ${poem.title} by ${poem.poet} (${poem.filepath})`);
    }
  }

  const appendSection = (heading, items, formatItem = (item) => `- ${item.date}: ${item.title} by ${item.poet} (${item.filepath})`) => {
    lines.push("", heading);
    if (items.length === 0) {
      lines.push("- None");
      return;
    }
    for (const item of items) {
      lines.push(formatItem(item));
    }
  };

  appendSection("Missing publication", report.missingPublication);
  appendSection("Missing source", report.missingSource);
  appendSection("Custom markup", report.customMarkup);
  lines.push("", "Poets");
  if (report.poetTallies.length === 0) {
    lines.push("- None");
  } else {
    for (const item of report.poetTallies) {
      lines.push(`- ${item.poet}: ${item.totalPoems} total | ${item.publishedPoems} published | ${item.scheduledPoems} scheduled`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function renderEditorialReport(poems, defaultAsOf = "") {
  const report = await createEditorialReport(poems, {
    asOfDate: defaultAsOf,
    poetPagesList: poetPages
  });
  await mkdir(reportsDir, { recursive: true });
  await writeFile(path.join(reportsDir, "editorial-report.json"), JSON.stringify(report, null, 2), "utf8");
  await writeFile(path.join(reportsDir, "editorial-report.txt"), formatEditorialReportText(report), "utf8");
}

async function renderNotFoundPage() {
  const assets = requireAssetManifest();
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
  <link rel="stylesheet" href="${assets.css}">
  <link rel="preload" href="${assets.fonts.regular400}" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${assets.fonts.bold700}" as="font" type="font/woff2" crossorigin>
  <link rel="manifest" href="${assets.manifest}">
  <link rel="alternate" type="application/rss+xml" title="A Poem Per Day RSS Feed" href="/rss.xml">
  <link rel="icon" type="image/png" sizes="512x512" href="${assets.icons.circle512}">
  <link rel="icon" type="image/png" sizes="32x32" href="${assets.icons.circle32}">
  <link rel="apple-touch-icon" sizes="180x180" href="${assets.icons.ios180}">
</head>
<body>
  <main>
    <h1>Page Not Found</h1>
    <article class="content-block">
      <p>The page you requested does not exist.</p>
      <p><a href="/">Go to Today</a> or browse the <a href="/archive/">archive</a>.</p>
    </article>
  </main>
  ${renderFooter("/")}
</body>
</html>
`;
  await writeFile(path.join(distDir, "404.html"), await minifyPageHtml(html), "utf8");
}

async function renderSeoFiles(poems, defaultAsOf = "") {
  const publishedPoems = publishedPoemsForDate(poems, defaultAsOf);
  const publishedAuthorPages = poetPagesWithPublishedPoems(publishedPoems);
  const robotsLines = ["User-agent: *", "Allow: /"];
  if (siteUrl) {
    robotsLines.push(`Sitemap: ${siteUrl}/sitemap.xml`);
  }
  await writeFile(path.join(distDir, "robots.txt"), `${robotsLines.join("\n")}\n`, "utf8");

  if (!siteUrl) {
    return;
  }

  const publicationCutoff = effectivePublicationCutoff(defaultAsOf);
  const [
    homeTemplateModifiedAt,
    archiveTemplateModifiedAt,
    aboutTemplateModifiedAt,
    poetsTemplateModifiedAt,
    poetTemplateModifiedAt,
    poemTemplateModifiedAt
  ] = await Promise.all([
    templateModifiedAt("index.html"),
    templateModifiedAt("archive.html"),
    templateModifiedAt("about.html"),
    templateModifiedAt("poets.html"),
    templateModifiedAt("poet.html"),
    templateModifiedAt("poem.html")
  ]);
  const publishedPoemsModifiedAt = poemsModifiedAt(publishedPoems);
  const routeEntries = [
    {
      routePath: "/",
      lastModifiedAt: mostRecentIsoTimestamp([homeTemplateModifiedAt, publishedPoemsModifiedAt])
    },
    {
      routePath: "/archive",
      lastModifiedAt: mostRecentIsoTimestamp([archiveTemplateModifiedAt, publishedPoemsModifiedAt])
    },
    {
      routePath: "/about",
      lastModifiedAt: aboutTemplateModifiedAt
    },
    {
      routePath: "/poets",
      lastModifiedAt: mostRecentIsoTimestamp([poetsTemplateModifiedAt, publishedPoemsModifiedAt])
    },
    ...publishedAuthorPages.map((entry) => ({
      routePath: entry.route,
      lastModifiedAt: mostRecentIsoTimestamp([
        poetTemplateModifiedAt,
        poemsModifiedAt(filterPoemsOnOrBefore(entry.poems, publicationCutoff))
      ])
    })),
    ...publishedPoems.map((poem) => ({
      routePath: poem.route,
      lastModifiedAt: mostRecentIsoTimestamp([poemTemplateModifiedAt, poem.sourceModifiedAt])
    }))
  ];
  const uniqueRoutes = Array.from(
    routeEntries.reduce((map, entry) => map.set(entry.routePath, entry.lastModifiedAt), new Map()).entries(),
    ([routePath, lastModifiedAt]) => ({ routePath, lastModifiedAt })
  );
  const urls = uniqueRoutes
    .map(({ routePath, lastModifiedAt }) => {
      const loc = absoluteRouteUrl(routePath);
      if (!loc) {
        return "";
      }
      return `<url><loc>${htmlEscape(loc)}</loc>${sitemapLastmodTag(lastModifiedAt)}</url>`;
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

  const fallbackDate = effectivePublicationCutoff(defaultAsOf);
  const published = filterPoemsOnOrBefore(poems, fallbackDate)
    .slice()
    .sort(comparePoemsByDateDesc);

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
      const usesCustomMarkup = poemUsesCustomMarkup(poem.poem);
      const itemDescription = renderRssItemDescription(poem, usesCustomMarkup);
      const contentHtml = usesCustomMarkup
        ? renderRssCustomMarkupFallback(link)
        : renderRssPoemMarkdown(poem.poem);

      return `<item>
      <title>${htmlEscape(itemTitle)}</title>
      <link>${htmlEscape(link)}</link>
      <guid isPermaLink="true">${htmlEscape(link)}</guid>
      <pubDate>${htmlEscape(pubDate)}</pubDate>
      <dc:creator>${htmlEscape(poem.poet)}</dc:creator>
      <description><![CDATA[${cdataSafe(itemDescription)}]]></description>
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

function buildRenderTasks(poems, asOfDate) {
  return [
    () => renderHome(poems, asOfDate),
    () => renderPoemPages(poems, asOfDate),
    () => renderPublishedPoemMarkdownFiles(poems, asOfDate),
    () => renderArchive(poems, asOfDate),
    () => renderPoets(poems, asOfDate),
    () => renderPoetPages(poems, asOfDate),
    () => renderAbout(),
    () => renderEditorialReport(poems, asOfDate),
    () => renderSeoFiles(poems, asOfDate),
    () => renderRssFeed(poems, asOfDate),
    () => renderNotFoundPage(),
    () => renderHeadersFile()
  ];
}

export async function build() {
  await ensureDist();
  socialCardStats = { generated: 0, cached: 0 };
  homePoemDataCache = new Map();
  poemPageDataCache = new Map();
  const loadedPoems = await loadPoems();
  poetPages = buildPoetPages(loadedPoems);
  const poems = preparePoems(loadedPoems, poetRouteMap(poetPages));
  const asOfDate = parseAsOfDateArg();
  assetManifest = await buildAssetManifest(poems, asOfDate);
  socialCardManifest = await buildSocialCardManifest(poems, asOfDate);

  await mapWithConcurrency(buildRenderTasks(poems, asOfDate), (task) => task());

  console.log(`Built Serein with ${poems.length} poems (local-date rendering enabled on /, /archive, and /poets).`);
  console.log(`Social cards: ${socialCardStats.cached} cached, ${socialCardStats.generated} generated.`);
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
