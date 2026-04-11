function normalizedDuplicateMetadataValue(input) {
  return String(input || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizedDuplicateBodyValue(input) {
  return String(input || "")
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

function poemSummary(poem) {
  return {
    date: poem.date,
    title: poem.title,
    poet: poem.poet,
    filepath: poem.filepath
  };
}

export function duplicatePoemGroups(poems) {
  const bySignature = new Map();

  for (const poem of poems) {
    const key = JSON.stringify([
      normalizedDuplicateMetadataValue(poem.title),
      normalizedDuplicateMetadataValue(poem.poet),
      normalizedDuplicateBodyValue(poem.poem)
    ]);
    if (!bySignature.has(key)) {
      bySignature.set(key, []);
    }
    bySignature.get(key).push(poem);
  }

  return Array.from(bySignature.values())
    .filter((matches) => matches.length > 1)
    .map((matches) => {
      const first = matches[0];
      const poemsInGroup = matches
        .slice()
        .sort((left, right) => left.date.localeCompare(right.date) || left.filepath.localeCompare(right.filepath))
        .map(poemSummary);

      return {
        title: first.title,
        poet: first.poet,
        count: poemsInGroup.length,
        poems: poemsInGroup
      };
    })
    .sort((left, right) => (
      left.title.localeCompare(right.title)
      || left.poet.localeCompare(right.poet)
      || left.poems[0].date.localeCompare(right.poems[0].date)
    ));
}
