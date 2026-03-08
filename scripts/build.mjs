import { mkdir, readdir, readFile, rm, writeFile, copyFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { marked } from "marked";
import { expectedPoemFilename, integerToWords } from "./poem-filenames.mjs";

const root = process.cwd();
const poemsDir = path.join(root, "poems");
const distDir = path.join(root, "dist");
const cacheDir = path.join(root, ".cache");
const socialCardCacheDir = path.join(cacheDir, "social-cards");
const reportsDir = path.join(root, "reports");
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
let authorPages = [];
let socialCardManifest = null;
let socialCardStats = { generated: 0, cached: 0 };
let socialCardFontConfigPath = "";
const SOCIAL_CARD_CACHE_VERSION = "png-v3";

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

  const fontConfigXml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <reset-dirs />
  <dir>${xmlEscape(path.join(assetsDir, "fonts"))}</dir>
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
  if (
    (raw.startsWith('"') && raw.endsWith('"'))
    || (raw.startsWith("'") && raw.endsWith("'"))
    || (raw.startsWith("\u201C") && raw.endsWith("\u201D"))
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
    author: "",
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

function renderCardTextLines(lines, { x, y, size, lineHeight, weight = "400", fill = "#2f2a25" }) {
  return lines
    .map(
      (line, index) => `<text x="${x}" y="${y + (index * lineHeight)}" font-family="'Libre Baskerville'" font-size="${size}" font-weight="${weight}" fill="${fill}">${htmlEscape(line)}</text>`
    )
    .join("");
}

function renderCenteredCardTextLines(lines, { centerX, startY, size, lineHeight, weight = "400", fill = "#ebe0d2" }) {
  return lines
    .map(
      (line, index) => `<text x="${centerX}" y="${startY + (index * lineHeight)}" text-anchor="middle" font-family="'Libre Baskerville'" font-size="${size}" font-weight="${weight}" fill="${fill}">${htmlEscape(line)}</text>`
    )
    .join("");
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

  routeCards.set("/", {
    path: await writeSocialCard(
      "home.png",
      renderSocialCardSvg({
        title: "A Poem Per Day"
      })
    ),
    alt: "A Poem Per Day"
  });

  routeCards.set("/archive", {
    path: await writeSocialCard(
      "archive.png",
      renderSocialCardSvg({
        title: "Archive"
      })
    ),
    alt: "Archive of A Poem Per Day"
  });

  routeCards.set("/poets", {
    path: await writeSocialCard(
      "poets.png",
      renderSocialCardSvg({
        title: "Poets"
      })
    ),
    alt: "Poets of A Poem Per Day"
  });

  routeCards.set("/about", {
    path: await writeSocialCard(
      "about.png",
      renderSocialCardSvg({
        title: "About"
      })
    ),
    alt: "About A Poem Per Day"
  });

  for (const poem of poems) {
    routeCards.set(poem.route, {
      path: await writeSocialCard(
        `poem-${poem.date}.png`,
        renderSocialCardSvg({
          title: poem.title
        })
      ),
      alt: poem.title
    });
  }

  for (const authorPage of authorPages) {
    routeCards.set(authorPage.route, {
      path: await writeSocialCard(
        `poet-${authorPage.slug}.png`,
        renderSocialCardSvg({
          title: authorPage.author
        })
      ),
      alt: `${authorPage.author} on A Poem Per Day`
    });
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

function plainTextExcerpt(input, maxLength = 220) {
  const normalized = String(input || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).replace(/\s+\S*$/g, "")}\u2026`;
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
  return routeRelativeAssetUrl(routePath, filename);
}

function fontPreloads(routePath) {
  const { fonts } = requireAssetManifest();
  return [
    `<link rel="preload" href="${fontPath(routePath, fonts.regular400)}" as="font" type="font/woff2" crossorigin>`,
    `<link rel="preload" href="${fontPath(routePath, fonts.bold700)}" as="font" type="font/woff2" crossorigin>`
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
    // Allow shorthand like: ::line |~4ch| some text
    // by treating trailing plain text as an implicit left segment.
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
        author: poem.author,
        filepath: poem.filepath
      }))
    }));
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
  const duplicates = duplicateDateEntries(poems);
  if (duplicates.length > 0) {
    const lines = duplicates
      .map((entry) => `${entry.date}: ${entry.poems.map((poem) => `${poem.title} (${poem.filepath})`).join(", ")}`)
      .join("; ");
    throw new Error(`Duplicate poem dates are not allowed. ${lines}`);
  }
  return poems;
}

export function preparePoems(poems, authorRouteByName = new Map()) {
  return poems.map((poem) => ({
    ...poem,
    authorRoute: authorRouteByName.get(poem.author) || "",
    authorMetaHtml: renderAuthorMeta({
      ...poem,
      authorRoute: authorRouteByName.get(poem.author) || ""
    }),
    poemHtml: renderPoemContent(poem, { includePublishedNote: false }),
    poemHtmlWithPublishedNote: renderPoemContent(poem, { includePublishedNote: true }),
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

function renderTranslatorMeta(poem) {
  const translator = htmlEscape(poem.translator || "");
  return translator ? `translated by ${translator}` : "";
}

function renderAuthorMeta(poem) {
  const authorName = htmlEscape(poem.author || "");
  const author = poem.authorRoute ? routeLink(poem.authorRoute, poem.author || "") : authorName;
  const parts = [author];
  const translator = renderTranslatorMeta(poem);
  const details = renderPublicationMeta(poem);
  if (translator) {
    parts.push(translator);
  }
  if (details) {
    parts.push(details);
  }
  return parts.join(' <span aria-hidden="true">&middot;</span> ');
}

function withCommonPageAssets(template, routePath, { scriptName = "", robotsMeta = "", twitterCard = "summary", socialMeta = "" } = {}) {
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

function renderPoemShell(template, poem, { noindex = true, routePath = "/", defaultAsOf = "" } = {}) {
  const description = `${poem.title} by ${poem.author}.`;
  const authorMeta = poem.authorMetaHtml || renderAuthorMeta(poem);
  const poemHtml =
    poem.poemHtmlWithPublishedNote || renderPoemContent(poem, { includePublishedNote: true });
  return withCommonPageAssets(template, routePath, {
    scriptName: "poem",
    robotsMeta: noindex ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow">',
    ...sharingOptions(routePath, {
      articlePublished: poem.date,
      articleAuthor: absoluteRouteUrl(poem.authorRoute) || poem.author
    })
  })
    .replaceAll("{{TITLE}}", htmlEscape(poem.title))
    .replaceAll("{{AUTHOR}}", htmlEscape(poem.author))
    .replaceAll("{{DESCRIPTION}}", htmlEscape(description))
    .replaceAll("{{PUBLICATION}}", htmlEscape(poem.publication))
    .replaceAll("{{DATE}}", htmlEscape(poem.date))
    .replaceAll("{{DEFAULT_AS_OF}}", htmlEscape(defaultAsOf))
    .replace("{{RUNTIME_AS_OF_ENABLED}}", runtimeAsOfDataValue())
    .replaceAll("{{AUTHOR_META}}", authorMeta)
    .replaceAll("{{PUBLICATION_META}}", renderPublicationMeta(poem))
    .replaceAll("{{POEM_TEXT}}", poemHtml)
    .replace("{{SCRIPT_PATH}}", scriptPath(routePath, "poem"));
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

async function renderPoemPages(publishedPoems, defaultAsOf = "") {
  const template = await readTemplate("poem.html");

  for (const poem of publishedPoems) {
    const html = renderPoemShell(template, poem, { noindex: false, routePath: poem.route, defaultAsOf });
    await writeRoutedPage(poem.route, html);
  }
}

async function renderArchive(poems, defaultAsOf = "") {
  const template = await readTemplate("archive.html");
  const fallbackDate = defaultAsOf || yyyyMmDdInTimeZone("Europe/Istanbul");
  const fallbackPoems = poems.filter((poem) => poem.date <= fallbackDate);
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
  const fallbackDate = defaultAsOf || yyyyMmDdInTimeZone("Europe/Istanbul");
  const fallbackPoems = poems.filter((poem) => poem.date <= fallbackDate);
  const fallbackPoem = fallbackPoems.find((poem) => poem.date === fallbackDate) || fallbackPoems[fallbackPoems.length - 1] || null;
  const fallbackTitle = fallbackPoem ? htmlEscape(fallbackPoem.title) : "A Poem Per Day";
  const fallbackMeta = fallbackPoem ? fallbackPoem.authorMetaHtml || renderAuthorMeta(fallbackPoem) : "";
  const fallbackDescription = "A new poem every day, published at midnight in your local time.";
  const fallbackBody = fallbackPoem
    ? fallbackPoem.poemHtml || renderPoemContent(fallbackPoem, { includePublishedNote: false })
    : '<p class="empty">No poem is published for today.</p>';
  const html = withCommonPageAssets(template, "/", {
    scriptName: "home",
    robotsMeta: '<meta name="robots" content="index, follow">',
    ...sharingOptions("/")
  })
    .replaceAll("{{PAGE_TITLE}}", "A Poem Per Day")
    .replaceAll("{{PAGE_DESCRIPTION}}", htmlEscape(fallbackDescription))
    .replaceAll("{{DEFAULT_AS_OF}}", htmlEscape(defaultAsOf))
    .replaceAll("{{RENDERED_AS_OF}}", htmlEscape(fallbackDate))
    .replace("{{RUNTIME_AS_OF_ENABLED}}", runtimeAsOfDataValue())
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

function longDateLabel(yyyyMmDd) {
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

function renderArchiveRow(poem, fromRoute) {
  const href = `${relativePrefix(fromRoute)}${poem.route.slice(1)}/`;
  const parts = parseDateParts(poem.date);
  const day = parts ? parts.day : "--";
  return `<li><span class="archive-day">${htmlEscape(day)}</span><span aria-hidden="true">&middot;</span><a href="${htmlEscape(href)}">${htmlEscape(poem.title)}</a></li>`;
}

const authorCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function normalizedAlphaText(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function authorInitial(author) {
  const normalized = normalizedAlphaText(author);
  const firstChar = normalized.charAt(0).toUpperCase();
  return /^[A-Z]$/.test(firstChar) ? firstChar : "#";
}

function slugifySegment(input) {
  const base = normalizedAlphaText(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "unknown";
}

export function buildAuthorPages(poems) {
  const poemsByAuthor = new Map();
  for (const poem of poems) {
    const author = String(poem.author || "").trim() || "Unknown";
    if (!poemsByAuthor.has(author)) {
      poemsByAuthor.set(author, []);
    }
    poemsByAuthor.get(author).push(poem);
  }

  const authors = Array.from(poemsByAuthor.keys()).sort((a, b) => authorCollator.compare(a, b));
  const slugCounts = new Map();

  return authors.map((author) => {
    const baseSlug = slugifySegment(author);
    const nextCount = (slugCounts.get(baseSlug) || 0) + 1;
    slugCounts.set(baseSlug, nextCount);
    const slug = nextCount === 1 ? baseSlug : `${baseSlug}-${nextCount}`;
    const route = `/poets/${slug}`;
    const authoredPoems = poemsByAuthor
      .get(author)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

    return {
      author,
      slug,
      route,
      poems: authoredPoems
    };
  });
}

function authorRouteMap(authorPagesList) {
  return new Map(authorPagesList.map((entry) => [entry.author, entry.route]));
}

function groupPoemsByAuthorInitial(publishedPoems) {
  const groups = new Map();
  const sorted = publishedPoems
    .slice()
    .sort((a, b) => authorCollator.compare(a.author, b.author) || b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

  for (const poem of sorted) {
    const author = String(poem.author || "").trim() || "Unknown";
    const initial = authorInitial(author);
    if (!groups.has(initial)) {
      groups.set(initial, new Map());
    }

    const authorsMap = groups.get(initial);
    if (!authorsMap.has(author)) {
      authorsMap.set(author, []);
    }

    authorsMap.get(author).push(poem);
  }

  for (const authorsMap of groups.values()) {
    for (const poems of authorsMap.values()) {
      poems.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
    }
  }

  return groups;
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

function renderArchiveTree(publishedPoems, today, fromRoute = "/archive") {
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

function renderPoetsTree(publishedPoems) {
  const grouped = groupPoemsByAuthorInitial(publishedPoems);
  const letters = Array.from(grouped.keys()).sort((a, b) => {
    if (a === "#") {
      return 1;
    }
    if (b === "#") {
      return -1;
    }
    return authorCollator.compare(a, b);
  });

  if (letters.length === 0) {
    return "<p>No published poets yet.</p>";
  }

  return letters
    .map((letter) => {
      const authorsMap = grouped.get(letter);
      const authors = Array.from(authorsMap.keys()).sort((a, b) => authorCollator.compare(a, b));
      const poetBlocks = authors
        .map((author) => {
          const poems = authorsMap.get(author);
          const authorRoute = poems[0]?.authorRoute || "";
          const authorLabel = authorRoute ? routeLink(authorRoute, author) : htmlEscape(author);
          return `<li class="poet-authors-item">${authorLabel}</li>`;
        })
        .join("");

      return `<details class="archive-year poet-letter"><summary>${htmlEscape(letter)}</summary><div class="archive-months poet-groups"><ul class="poet-authors">${poetBlocks}</ul></div></details>`;
    })
    .join("");
}

async function renderPoets(poems, defaultAsOf = "") {
  const template = await readTemplate("poets.html");
  const fallbackDate = defaultAsOf || yyyyMmDdInTimeZone("Europe/Istanbul");
  const fallbackPoems = poems.filter((poem) => poem.date <= fallbackDate);
  const rows = renderPoetsTree(fallbackPoems);
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

function spelloutCount(count) {
  if (!Number.isInteger(count) || count < 0) {
    return String(count);
  }
  if (count === 0) {
    return "no";
  }
  return integerToWords(String(count)) || String(count);
}

function poetMetaLabel(count) {
  return `This poet has ${spelloutCount(count)} published ${poetCountNoun(count)}`;
}

async function renderPoetPages(poems, defaultAsOf = "") {
  const template = await readTemplate("poet.html");
  const fallbackDate = defaultAsOf || yyyyMmDdInTimeZone("Europe/Istanbul");

  for (const authorPage of authorPages) {
    const fallbackPoems = authorPage.poems.filter((poem) => poem.date <= fallbackDate);
    const rows = fallbackPoems.length > 0
      ? renderArchiveTree(fallbackPoems, fallbackDate, authorPage.route)
      : `<p>No published poems by ${htmlEscape(authorPage.author)} yet.</p>`;
    const description = poetMetaLabel(fallbackPoems.length);
    const html = withCommonPageAssets(template, authorPage.route, {
      scriptName: "poetPage",
      robotsMeta: '<meta name="robots" content="index, follow">',
      ...sharingOptions(authorPage.route)
    })
      .replaceAll("{{AUTHOR}}", htmlEscape(authorPage.author))
      .replaceAll("{{PAGE_DESCRIPTION}}", htmlEscape(description))
      .replaceAll("{{DEFAULT_AS_OF}}", htmlEscape(defaultAsOf))
      .replaceAll("{{RENDERED_AS_OF}}", htmlEscape(fallbackDate))
      .replace("{{RUNTIME_AS_OF_ENABLED}}", runtimeAsOfDataValue())
      .replace("{{AUTHOR_ROUTE}}", htmlEscape(authorPage.route))
      .replace("{{POET_META}}", htmlEscape(poetMetaLabel(fallbackPoems.length)))
      .replace("{{FALLBACK_POEMS}}", rows)
      .replace("{{PAGE_DATA_URL}}", pageDataPath(authorPage.route, "poets"));

    await writeRoutedPage(authorPage.route, html);
  }
}

function renderPublishedOnNote(poem) {
  return `<p class="published-note">Published on ${htmlEscape(longDateLabel(poem.date))}</p>`;
}

function renderPoemContent(poem, { includePublishedNote = true } = {}) {
  const poemHtml = renderPoemMarkdown(poem.poem, poem.highlights);
  if (!includePublishedNote) {
    return poemHtml;
  }
  return `${poemHtml}${renderPublishedOnNote(poem)}`;
}

async function renderHomeData(poems) {
  const home = poems.map((poem) => ({
    title: poem.title,
    date: poem.date,
    authorMetaHtml: poem.authorMetaHtml || renderAuthorMeta(poem),
    poemHtml: poem.poemHtml || renderPoemContent(poem, { includePublishedNote: false })
  }));

  return writeFingerprintedAsset({
    name: "home-data",
    extension: ".json",
    subdir: "assets/data",
    contents: JSON.stringify(home)
  });
}

async function renderArchiveData(poems) {
  const archive = poems.map((poem) => ({
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

async function renderPoetsData(poems) {
  const poets = poems.map((poem) => ({
    title: poem.title,
    author: poem.author,
    authorRoute: poem.authorRoute,
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

async function buildAssetManifest(poems) {
  const [bundledAssets, homeData, archiveData, poetsData, circle32, circle192, circle512, ios180] = await Promise.all([
    buildBundledAssetManifest(),
    renderHomeData(poems),
    renderArchiveData(poems),
    renderPoetsData(poems),
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

/*
  Cache-Control: public, max-age=0, must-revalidate
`;
  await writeFile(path.join(distDir, "_headers"), headers, "utf8");
}

export function createEditorialReport(poems, { asOfDate = "", authorPagesList = authorPages } = {}) {
  const effectiveAsOf = asOfDate || yyyyMmDdInTimeZone("Europe/Istanbul");
  const publishedPoems = poems.filter((poem) => poem.date <= effectiveAsOf);
  const upcomingPoems = poems.filter((poem) => poem.date > effectiveAsOf);
  const missingPublication = poems
    .filter((poem) => !String(poem.publication || "").trim())
    .map((poem) => ({ date: poem.date, title: poem.title, author: poem.author, filepath: poem.filepath }));
  const missingSource = poems
    .filter((poem) => !String(poem.source || "").trim())
    .map((poem) => ({ date: poem.date, title: poem.title, author: poem.author, filepath: poem.filepath }));
  const customMarkup = poems
    .filter((poem) => poemUsesCustomMarkup(poem.poem))
    .map((poem) => ({ date: poem.date, title: poem.title, author: poem.author, filepath: poem.filepath }));

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

  const publishedAuthorCount = new Set(publishedPoems.map((poem) => poem.author)).size;

  return {
    generatedAt: new Date().toISOString(),
    asOfDate: effectiveAsOf,
    totals: {
      poems: poems.length,
      publishedPoems: publishedPoems.length,
      upcomingPoems: upcomingPoems.length,
      authors: authorPagesList.length,
      publishedAuthors: publishedAuthorCount,
      missingPublication: missingPublication.length,
      missingSource: missingSource.length,
      customMarkup: customMarkup.length
    },
    upcomingPoems: upcomingPoems.map((poem) => ({
      date: poem.date,
      title: poem.title,
      author: poem.author,
      filepath: poem.filepath
    })),
    scheduleGaps,
    missingPublication,
    missingSource,
    customMarkup
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
    `- Authors: ${report.totals.authors}`,
    `- Published authors: ${report.totals.publishedAuthors}`,
    `- Missing publication fields: ${report.totals.missingPublication}`,
    `- Missing source fields: ${report.totals.missingSource}`,
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

  lines.push("", "Upcoming poems");
  if (report.upcomingPoems.length === 0) {
    lines.push("- None");
  } else {
    for (const poem of report.upcomingPoems) {
      lines.push(`- ${poem.date}: ${poem.title} by ${poem.author} (${poem.filepath})`);
    }
  }

  const appendSection = (heading, items) => {
    lines.push("", heading);
    if (items.length === 0) {
      lines.push("- None");
      return;
    }
    for (const item of items) {
      lines.push(`- ${item.date}: ${item.title} by ${item.author} (${item.filepath})`);
    }
  };

  appendSection("Missing publication", report.missingPublication);
  appendSection("Missing source", report.missingSource);
  appendSection("Custom markup", report.customMarkup);

  return `${lines.join("\n")}\n`;
}

async function renderEditorialReport(poems, defaultAsOf = "") {
  const report = createEditorialReport(poems, {
    asOfDate: defaultAsOf,
    authorPagesList: authorPages
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
  <footer class="site-footer"><a href="/">Today</a><span aria-hidden="true">&bull;</span><a href="/archive/">Archive</a><span aria-hidden="true">&bull;</span><a href="/about/">About</a></footer>
</body>
</html>
`;
  await writeFile(path.join(distDir, "404.html"), await minifyPageHtml(html), "utf8");
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

  const routePaths = [
    "/",
    "/archive",
    "/about",
    "/poets",
    ...authorPages.map((entry) => entry.route),
    ...publishedPoems.map((poem) => poem.route)
  ];
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
      const itemDescription = plainTextExcerpt(poem.searchText || markdownStrip(poem.poem));
      const contentHtml = poemUsesCustomMarkup(poem.poem)
        ? `<p>This poem uses special formatting that is not suited for RSS feeds. Please <a href="${htmlEscape(
            link
          )}">visit the website to read it</a>.</p>`
        : poemHtml;

      return `<item>
      <title>${htmlEscape(itemTitle)}</title>
      <link>${htmlEscape(link)}</link>
      <guid isPermaLink="true">${htmlEscape(link)}</guid>
      <pubDate>${htmlEscape(pubDate)}</pubDate>
      <dc:creator>${htmlEscape(poem.author)}</dc:creator>
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

export async function build() {
  await ensureDist();
  socialCardStats = { generated: 0, cached: 0 };
  const loadedPoems = await loadPoems();
  authorPages = buildAuthorPages(loadedPoems);
  const poems = preparePoems(loadedPoems, authorRouteMap(authorPages));
  authorPages = buildAuthorPages(poems);
  const asOfDate = parseAsOfDateArg();
  assetManifest = await buildAssetManifest(poems);
  socialCardManifest = await buildSocialCardManifest(poems, asOfDate);

  await Promise.all([
    renderHome(poems, asOfDate),
    renderPoemPages(poems, asOfDate),
    renderArchive(poems, asOfDate),
    renderPoets(poems, asOfDate),
    renderPoetPages(poems, asOfDate),
    renderAbout(),
    renderEditorialReport(poems, asOfDate),
    renderSeoFiles(poems),
    renderRssFeed(poems, asOfDate),
    renderNotFoundPage(),
    renderHeadersFile()
  ]);

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
