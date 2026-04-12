import process from "node:process";
import { buildPoetPages, createEditorialReport, formatEditorialReportText, loadPoems, preparePoems } from "./build.mjs";
import { canRenderEditorialReportTui, runEditorialReportTui } from "./editorial-report-ui.mjs";
import { fixPoetProximity } from "./normalize-poems.mjs";

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

const asOfDate = parseAsOfDateArg();

async function loadEditorialState() {
  const rawPoems = await loadPoems();
  const poets = buildPoetPages(rawPoems);
  const poetRouteByName = new Map(poets.map((entry) => [entry.poet, entry.route]));
  const poems = preparePoems(rawPoems, poetRouteByName);
  const report = await createEditorialReport(poems, {
    asOfDate,
    poetPagesList: poets
  });

  return {
    report
  };
}

const { report } = await loadEditorialState();

if (canRenderEditorialReportTui()) {
  await runEditorialReportTui(report, {
    title: "SEREIN EDITORIAL REPORT",
    onApplyPoetProximityFix: async (item) => {
      const result = await fixPoetProximity(item.later.filepath, {
        quiet: true,
        asOfDate: report.asOfDate
      });
      const nextState = await loadEditorialState();
      return {
        report: nextState.report,
        message: `Moved ${result.moves.length} poem(s) for ${result.poet}.`
      };
    }
  });
} else {
  process.stdout.write(formatEditorialReportText(report));
}
