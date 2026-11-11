# Inno-AI: Ingredient Compliance Checker

Paste a food ingredient list, choose the EU or US market, and see which additives are approved, restricted or banned, with substitution ideas for the problem ones.

Built as a single Cloudflare Worker with a free **Cloudflare D1** (SQLite) database. No Supabase, no external services, no API keys.

> The bundled dataset is a small demonstration set. It is not legal or regulatory advice; verify every decision against the official EU and FDA sources.

## How it works

- `index.ts`: the Worker. Serves the page and a small JSON API, and creates and seeds the D1 tables on first use.
- `data.ts`: the demo ingredient, rule and substitute data.
- `page.ts`: the single-page UI.
- D1 tables: `ingredients`, `rules`, `substitutes`, `checks`. Only anonymous counts are stored for each check, never the ingredient text.

API: `GET /api/health`, `GET /api/ingredients`, `GET /api/recent`, `POST /api/check` with `{ "ingredients": "...", "market": "EU" | "US" }`.

## Run locally

```
npm install
npm run dev
```

## Deploy on Cloudflare

1. Create a D1 database named `inno-ai-db` and put its id in `wrangler.jsonc` (`database_id`).
2. Connect this repository in Cloudflare (Workers & Pages, Import a repository) or run `npm run deploy`.

## Licence

MIT
