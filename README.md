# Inno-AI: Ingredient Compliance Platform

Check food ingredient lists against **EU and US additive rules**, scan labels, get **substitution ideas**, run **batch checks** and ask a **regulatory assistant**. It runs entirely on Cloudflare's free tier: one Worker, a **D1 (SQLite)** database and Workers AI. No external services, no API keys.

**Live demo:** https://inno-ai.abdullah-al-fahad.workers.dev

> The bundled dataset is a demonstration set of 65 additives. It is not legal or regulatory advice; verify every decision against the official EU and FDA sources.

## Features

| Feature | How it works |
| --- | --- |
| Real-time compliance check | Parses free-text lists (brackets, groups like `colours (E102, E110)`, E-numbers in any spelling, aliases such as "Red 40") and returns a verdict per market. |
| EU vs US side by side | Pick one or both markets; every ingredient shows status and the regulatory note for each. |
| Label scanner | Upload a photo of a label; text is read in your browser with Tesseract.js (the image never leaves your device), then you review it and check. |
| Substitution engine | Restricted or banned additives list vetted alternatives. |
| Batch mode | Paste `Product | ingredients` lines or upload a CSV, get a verdict per product, export CSV. |
| Regulatory assistant | Retrieves matching rows from D1 and answers with Workers AI (Llama 3.1 8B). Falls back to a plain database answer if AI is unavailable. |
| Shareable reports | Opt-in "Save and share link" stores one report behind an unguessable URL. |
| Dashboard | Anonymous usage statistics and the most-flagged additives. |
| Ingredient database | Searchable table of every additive, rule and alternative. |

## Architecture

```
public/            Static UI (HTML, CSS, vanilla JS) served by Workers Static Assets
src/index.ts       Worker entry: /api/* to the API, everything else to assets
functions/api/     Pages Functions entry (optional second target, same API)
src/api.ts         Routes: check, batch, assistant, stats, ingredients, reports
src/matcher.ts     Pure parsing, matching and verdict logic (unit tested)
src/db.ts          D1 access, auto-creates the schema and syncs the dataset
src/data.ts        Demonstration dataset (bump DATASET_VERSION to re-sync)
migrations/        SQL schema for `wrangler d1 migrations`
test/              Node test runner tests (matcher logic + jsdom UI routing)
```

D1 tables: `ingredients`, `rules`, `substitutes`, `checks`, `flag_counts`, `reports`, `meta`. Checks store **counts only**, never ingredient text. Ingredient text is stored only when you explicitly save a report.

### API

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/health` | |
| GET | `/api/ingredients?q=` | |
| GET | `/api/stats` | |
| POST | `/api/check` | `{ "ingredients": "...", "markets": ["EU","US"], "save": false }` |
| POST | `/api/batch` | `{ "markets": ["EU"], "rows": [{ "name": "...", "ingredients": "..." }] }` |
| POST | `/api/assistant` | `{ "question": "Is E171 allowed in the EU?" }` |
| GET | `/api/reports/:id` | |

## Run locally

```
npm install
npm run dev      # http://localhost:8787 with a local D1
npm test         # matcher logic and frontend routing tests
npm run typecheck
```

## Deploy on Cloudflare

1. Create a D1 database named `inno-ai-db` and put its id in `wrangler.jsonc` (`database_id`).
2. Run `npm run deploy`, or connect this repository in Cloudflare (Workers & Pages, Import a repository) so every push to `main` deploys.

The Worker creates its tables on first request. To apply the schema explicitly instead, run `npm run db:migrate`.

### Deploying to Pages instead, for a custom domain

A Worker custom domain must be a zone inside the same Cloudflare account. A Pages
project accepts a custom domain whose DNS is hosted elsewhere, so a free name such
as `inno-ai.is-a.dev` only works on Pages.

`functions/api/[[path]].ts` makes that possible without a second implementation:
it calls the same `handleApi`, so both targets share one API and one test suite.
`public/_routes.json` sends only `/api/*` to a Function and `public/_redirects`
serves `index.html` for client-side routes such as `/r/<id>`, replacing the
Worker's `assets.not_found_handling`.

Pages reads its build settings from the dashboard rather than `wrangler.jsonc`,
which stays the Worker configuration:

1. Workers & Pages -> Create -> Pages -> Connect to Git, pick this repository.
2. Build command: none. Build output directory: `public`.
3. Settings -> Functions: bind D1 as `DB` (`inno-ai-db`) and Workers AI as `AI`.
4. Custom domains -> Set up a domain **before** creating the DNS record, then add
   an unproxied `CNAME` to `<project>.pages.dev`. The other order returns 522 to
   every visitor, and a proxied record returns Error 1014.

`npm run pages:build` compiles the Function locally to check it still bundles.

## Extending the dataset

Add entries to `SEED` in `src/data.ts` and bump `DATASET_VERSION`. On the next request the Worker upserts the changes into D1. Markets are defined in `MARKETS`; adding a country means adding a rule for it on each entry.

## Licence

MIT
