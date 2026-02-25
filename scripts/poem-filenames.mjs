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
  return expectedPoemFilenameWithExtension(poem, ".md");
}

export function expectedPoemFilenameWithExtension(poem, extension = ".md") {
  const date = String(poem?.date || "").trim();
  const titleSlug = slugifyForFilename(poem?.title || "");
  if (!date || !titleSlug) {
    return null;
  }
  const ext = String(extension || ".md");
  return `${date}-${titleSlug}${ext.startsWith(".") ? ext : `.${ext}`}`;
}
