import process from "node:process";
import { buildAuthorPages, createEditorialReport, formatEditorialReportText, loadPoems, preparePoems } from "./build.mjs";

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

const rawPoems = await loadPoems();
const authors = buildAuthorPages(rawPoems);
const authorRouteByName = new Map(authors.map((entry) => [entry.author, entry.route]));
const poems = preparePoems(rawPoems, authorRouteByName);
const report = createEditorialReport(poems, {
  asOfDate: parseAsOfDateArg(),
  authorPagesList: buildAuthorPages(poems)
});

process.stdout.write(formatEditorialReportText(report));
