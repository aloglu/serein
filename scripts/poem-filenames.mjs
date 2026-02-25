export function slugifyForFilename(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function expectedPoemFilename(poem) {
  const date = String(poem?.date || "").trim();
  const titleSlug = slugifyForFilename(poem?.title || "");
  if (!date || !titleSlug) {
    return null;
  }
  return `${date}-${titleSlug}.json`;
}
