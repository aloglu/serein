# Poetry curation guide

Last updated: 2026-10-21

Keep this document for future replenishment. Read it alongside README.md and the current scheduling/rendering code. The poem files are the authoritative catalogue; rebuild any inventory from them rather than retaining an old snapshot.

## Selection

- Choose established poetry from the global literary canon. Seek diversity across regions, languages, cultures, genders, eras, and traditions; do not let readily available English-language work dominate.
- Publish in English, including encouraged translations. Identify and credit every translator for the exact version used.
- Prefer poems under 40 verse lines, with a normal ceiling of 60. Rare exceptions are allowed for exceptionally significant/popular complete works; record the reason. Display wrapping and blank separators are not extra verse lines.
- Publish complete poems, never truncated extracts presented as whole works.
- Do not repeat a work already published or scheduled. Compare canonical poet identities, original titles, alternate titles, incipits and bodies; a different translation is still the same underlying poem. Equal titles by different poets are not automatically duplicates.
- Choose texts whose complete, credited English versions can be located online. Prefer publisher, literary journal, poet/translator, university, or established poetry-organization sources over unattributed reposts. Do not select a work solely from a catalogue entry or scholarly excerpt and leave the owner unable to find its text.
- Work from reliable text transcriptions. Do not restart a routine image-download/OCR workflow; the owner explicitly rejected that approach.
- Prefer meaningful date pairings with holidays, commemorations, literary anniversaries and seasons, including Türkiye and the cultures represented. Verify intended-year dates and movable observances; do not force a theme.

## Frontmatter and filenames

```md
---
title: The Title
poet: The Poet
translator: Translator Name
date: 2026-10-29
---

The poem body.
```

- Use `title`, `poet`, `date`, and `translator` where applicable. Omit `translator` for English originals.
- Do **not** include `source` or `publication` in poem frontmatter, even when known. Record source editions, URLs and reproduction evidence in curation notes instead.
- When more than two people are credited in total across poets and translators, use `&` rather than `and` between contributor names. Retain every contributor’s name.
- Leave ordinary text unquoted. Use **double quotes** when YAML syntax or implicit typing requires them: for example `: `, a comment-forming ` #`, leading YAML indicators/quotes, or numeric/boolean/null-like text. Escape embedded double quotes as `\"` and backslashes as `\\`; preserve the intended parsed text. Validate with both YAML and the project’s custom parser.
- A dated filename must have the **same concrete date** in frontmatter. Example: `2026-11-09-stepping-stones.md` has `date: 2026-11-09`.
- Use `date: next` only for files still awaiting automatic date assignment. Once a file receives a dated filename, replace `next` with that date.
- Place dated files under `poems/YYYY/MM-Month/YYYY-MM-DD-slug.md`. Use exact existing poet strings so aliases do not bypass scheduling checks.

## Scheduling and typography

- `scripts/poet-proximity.mjs` enforces a 30-day cooldown: at least **31 days between poems by the same poet**.
- `scripts/normalize-poems.mjs` resolves `next` in alphabetical path order, respecting occupied dates and cooldowns. Its cursor moves forward after each assignment; later entries do not backfill days skipped by a cooldown jump.
- Simulate the actual queue before promising occasion dates or continuous coverage. Preserve existing reservations and check against future as well as past poems.
- Leave real normalization, commits, pushing and deployment to the owner unless explicitly requested.
- Preserve source spelling, capitalization, punctuation, lineation, stanzas, indentation, alignment and emphasis. Do not silently modernize or regularize text.
- Use supported `::line` markup where necessary. Distinguish hanging continuations from new verse lines; preserve meaningful internal spacing.
- The normalizer intentionally repairs punctuation, including `--` to em dashes, smart quotes and ellipses. Compare normalized/rendered output with the selected text to ensure those repairs restore rather than alter the source. Keep YAML-required quotes.
- At each replenishment, check for duplicates, filename/date agreement, poet spacing, complete bodies and faithful rendering. Refresh the inventory after manual edits; do not overwrite the owner’s progress with generated snapshots.
