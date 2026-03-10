# Serein

Serein powers [A Poem Per Day](https://apoemperday.com), a static site that publishes one poem per day from Markdown source files.

If you would like to share a poem to be published on the website, feel free to [get in touch](mailto:send@apoemperday.com).

## Overview

- `poems/` contains the source poems.
- `templates/` contains the HTML templates.
- `assets/` contains styles, browser scripts, fonts, and branding assets.
- `scripts/` contains the build and maintenance scripts.
- `.github/workflows/` contains CI and deployment automation.

`scripts/build.mjs` validates poem metadata, renders the site, bundles assets, and generates supporting artifacts such as social cards, editorial reports, and, when `SITE_URL` is set, RSS and sitemap files.

## Requirements

- Node.js 20 or newer
- npm

## Common commands

```bash
npm ci
npm run build
npm run preview
```

- `npm run dev`: rebuild on change
- `npm run dev:preview`: run watch mode and a local preview server together
- `npm run normalize:poems`: normalize poem paths, filenames, and typography
- `npm run editorial:report`: print the editorial report
- `npm run editorial:links`: check poem source URLs

For date-specific previews:

- `npm run build -- --as-of YYYY-MM-DD`
- `npm run dev -- --as-of YYYY-MM-DD`
- `npm run editorial:report -- --as-of YYYY-MM-DD`
- `npm run dev:preview:asof -- --as-of YYYY-MM-DD`

## Poem format

Each poem is a Markdown file with frontmatter.

```md
---
title: The Title
author: The Poet
translator:
date: 2026-03-10
publication:
source:
---

First line of the poem.
Second line of the poem.
```

Required fields:

- `title`
- `author`
- `date`
- poem body

Optional fields:

- `translator`
- `publication`
- `source`

Rules:

- Files must be Markdown.
- Paths must follow `poems/YYYY/MM-Month/YYYY-MM-DD-slug.md`.
- Poem dates must be unique.
- `translator`, `publication`, and `source` are optional, but missing metadata is still surfaced by the editorial checks.
- Custom markup is supported for aligned lines (`::line`) and inline highlights (`==...==`).

After adding or renaming poems, run:

```bash
npm run normalize:poems
```

## Publishing model

- Each poem is published at `/YYYY/MM/DD/`.
- The homepage, archive, poets index, and poet pages resolve against the viewer's local date.
- Future-dated poem pages remain unavailable until local midnight on the scheduled date.

For controlled previews:

- Build-time: `--as-of YYYY-MM-DD` or `SEREIN_AS_OF`
- Runtime: `SEREIN_ENABLE_RUNTIME_AS_OF=1` with `?as_of=YYYY-MM-DD`

## Deployment

- CI runs `npm run build` on pushes and pull requests.
- A scheduled GitHub Actions workflow triggers the Cloudflare Pages deploy hook at midnight Istanbul time.
- Set `SITE_URL` in deployment environments to enable canonical URLs, the sitemap, and RSS.

## License

Released under the [MIT License](LICENSE).