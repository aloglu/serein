import assert from "node:assert/strict";
import test from "node:test";
import { buildPoetPages, createEditorialReport, formatEditorialReportText } from "../scripts/build.mjs";

function poemFixture({
  title,
  poet,
  date,
  poem,
  filepath,
  publication = "Collected Poems",
  source = "https://example.com/source"
}) {
  return {
    title,
    poet,
    date,
    poem,
    filepath,
    publication,
    source
  };
}

test("editorial report includes duplicate poem groups and poet tallies", async () => {
  const poems = [
    poemFixture({
      title: "Counting Stars",
      poet: "Ada Lovelace",
      date: "2026-04-01",
      poem: "One line.\nTwo lines.",
      filepath: "poems/2026/04-April/2026-04-01-counting-stars.md"
    }),
    poemFixture({
      title: "Counting Stars",
      poet: "Ada Lovelace",
      date: "2026-04-04",
      poem: "One line.  \nTwo lines.   ",
      filepath: "poems/2026/04-April/2026-04-04-counting-stars.md"
    }),
    poemFixture({
      title: "Ledger",
      poet: "Ada Lovelace",
      date: "2026-04-08",
      poem: "Tomorrow's account.",
      filepath: "poems/2026/04-April/2026-04-08-ledger.md"
    }),
    poemFixture({
      title: "Moon Notes",
      poet: "Mary Shelley",
      date: "2026-04-03",
      poem: "Night writes first.",
      filepath: "poems/2026/04-April/2026-04-03-moon-notes.md"
    })
  ];

  const report = await createEditorialReport(poems, {
    asOfDate: "2026-04-05",
    poetPagesList: buildPoetPages(poems)
  });

  assert.equal(report.totals.poems, 4);
  assert.equal(report.totals.publishedPoems, 3);
  assert.equal(report.totals.upcomingPoems, 1);
  assert.equal(report.totals.poets, 2);
  assert.equal(report.totals.publishedPoets, 2);
  assert.equal(report.totals.duplicatePoems, 1);

  assert.deepEqual(report.duplicatePoems, [
    {
      title: "Counting Stars",
      poet: "Ada Lovelace",
      count: 2,
      poems: [
        {
          date: "2026-04-01",
          title: "Counting Stars",
          poet: "Ada Lovelace",
          filepath: "poems/2026/04-April/2026-04-01-counting-stars.md"
        },
        {
          date: "2026-04-04",
          title: "Counting Stars",
          poet: "Ada Lovelace",
          filepath: "poems/2026/04-April/2026-04-04-counting-stars.md"
        }
      ]
    }
  ]);

  assert.deepEqual(report.poetTallies, [
    {
      poet: "Ada Lovelace",
      totalPoems: 3,
      publishedPoems: 2,
      scheduledPoems: 1
    },
    {
      poet: "Mary Shelley",
      totalPoems: 1,
      publishedPoems: 1,
      scheduledPoems: 0
    }
  ]);

  const textReport = formatEditorialReportText(report);
  assert.match(textReport, /Duplicate poems/);
  assert.match(textReport, /Counting Stars by Ada Lovelace: 2 entries/);
  assert.match(textReport, /Poets/);
  assert.match(textReport, /Ada Lovelace: 3 total \| 2 published \| 1 scheduled/);
});
