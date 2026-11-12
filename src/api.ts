import { MARKETS, type Market } from "./data.ts";
import { ensureSchema, loadEntries } from "./db.ts";
import { evaluate, norm, parseList, type Entry, type IngredientResult } from "./matcher.ts";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI?: Ai;
}

const MAX_CHARS = 6000;
const MAX_ITEMS = 150;
const MAX_BATCH_ROWS = 50;

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new HttpError(400, "Send a JSON object body.");
}

function parseMarkets(body: Record<string, unknown>): Market[] {
  const raw = Array.isArray(body.markets) ? body.markets : body.market ? [body.market] : ["EU"];
  const out = [...new Set(raw)] as Market[];
  if (!out.length || out.some((m) => !MARKETS.includes(m))) throw new HttpError(400, "markets must be a list of EU and/or US.");
  return out;
}

function parseText(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, "ingredients must be a non-empty string.");
  if (v.length > MAX_CHARS) throw new HttpError(400, `Ingredient list too long (max ${MAX_CHARS} characters).`);
  return v;
}

async function run(env: Env, text: string, markets: Market[]) {
  const entries = await loadEntries(env.DB);
  const items = parseList(text).slice(0, MAX_ITEMS);
  if (!items.length) throw new HttpError(400, "No ingredients found in the text.");
  return evaluate(items, entries, markets);
}

/** Stores anonymous counts only: never the ingredient text. */
async function recordStats(env: Env, results: IngredientResult[], summary: Record<string, { verdict: string; counts: { total: number; banned: number; restricted: number; unknown: number } }>) {
  const stmts: D1PreparedStatement[] = [];
  for (const [market, s] of Object.entries(summary)) {
    stmts.push(
      env.DB.prepare("INSERT INTO checks (market, verdict, total, banned, restricted, unknown) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(market, s.verdict, s.counts.total, s.counts.banned, s.counts.restricted, s.counts.unknown),
    );
    for (const r of results) {
      const st = r.rules[market as Market].status;
      if (r.entryId && (st === "banned" || st === "restricted")) {
        stmts.push(
          env.DB.prepare("INSERT INTO flag_counts (ingredient_id, market, status, n) VALUES (?, ?, ?, 1) ON CONFLICT(ingredient_id, market, status) DO UPDATE SET n = n + 1")
            .bind(r.entryId, market, st),
        );
      }
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
}

function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return [...b].map((x) => (x % 36).toString(36)).join("");
}

async function check(req: Request, env: Env): Promise<Response> {
  const body = await readBody(req);
  const markets = parseMarkets(body);
  const text = parseText(body.ingredients);
  const { results, summary } = await run(env, text, markets);
  await recordStats(env, results, summary);
  let report: { id: string } | undefined;
  if (body.save === true) {
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 80) : "Untitled check";
    const id = newId();
    await env.DB.prepare("INSERT INTO reports (id, title, ingredients, payload) VALUES (?, ?, ?, ?)")
      .bind(id, title, text, JSON.stringify({ markets, summary, results })).run();
    report = { id };
  }
  return json({ markets, summary, results, report });
}

async function batch(req: Request, env: Env): Promise<Response> {
  const body = await readBody(req);
  const markets = parseMarkets(body);
  if (!Array.isArray(body.rows) || !body.rows.length) throw new HttpError(400, "rows must be a non-empty list.");
  if (body.rows.length > MAX_BATCH_ROWS) throw new HttpError(400, `Too many rows (max ${MAX_BATCH_ROWS}).`);
  const entries = await loadEntries(env.DB);
  const out = [];
  const stats: D1PreparedStatement[] = [];
  for (const row of body.rows as { name?: unknown; ingredients?: unknown }[]) {
    const text = parseText(row?.ingredients);
    const items = parseList(text).slice(0, MAX_ITEMS);
    if (!items.length) continue;
    const { results, summary } = evaluate(items, entries, markets);
    out.push({
      name: typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 80) : `Product ${out.length + 1}`,
      summary,
      flagged: results
        .filter((r) => markets.some((m) => r.rules[m].status !== "approved"))
        .map((r) => ({ name: r.name, eNumber: r.eNumber, EU: r.rules.EU.status, US: r.rules.US.status })),
    });
    for (const [market, s] of Object.entries(summary)) {
      stats.push(
        env.DB.prepare("INSERT INTO checks (market, verdict, total, banned, restricted, unknown) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(market, s.verdict, s.counts.total, s.counts.banned, s.counts.restricted, s.counts.unknown),
      );
    }
  }
  if (stats.length) await env.DB.batch(stats);
  return json({ markets, rows: out });
}

async function listIngredients(url: URL, env: Env): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
  const entries = await loadEntries(env.DB);
  const rows = entries
    .filter((e) => !q || [...e.keys].some((k) => k.includes(q)) || e.category.toLowerCase().includes(q))
    .map((e) => ({
      name: e.name, eNumber: e.eNumber, category: e.category, EU: e.rules.EU, US: e.rules.US, substitutes: e.subs,
    }));
  return json({ total: entries.length, ingredients: rows });
}


const MODEL = "@cf/meta/llama-3.1-8b-instruct";

function describe(e: Entry): string {
  const r = (m: Market) => (e.rules[m] ? `${e.rules[m]!.status} (${e.rules[m]!.note})` : "no data");
  const subs = e.subs.length ? ` Substitutes: ${e.subs.join(", ")}.` : "";
  return `${e.name}${e.eNumber ? ` (${e.eNumber})` : ""}, ${e.category}. EU: ${r("EU")}. US: ${r("US")}.${subs}`;
}

/** Answers a regulatory question with retrieval over the D1 dataset, then Workers AI when it is available. */
async function assistant(req: Request, env: Env): Promise<Response> {
  const body = await readBody(req);
  const q = typeof body.question === "string" ? body.question.trim() : "";
  if (!q || q.length > 500) throw new HttpError(400, "question must be 1 to 500 characters.");
  const entries = await loadEntries(env.DB);
  const padded = ` ${norm(q)} `;
  const eNums = [...q.toLowerCase().matchAll(/\be\s?-?(\d{3,4}[a-z]?)\b/g)].map((m) => "e" + m[1]);
  let hits = entries.filter((e) => [...e.keys].some((k) => (k.length >= 3 && padded.includes(` ${k} `)) || eNums.includes(k)));
  if (!hits.length) {
    const cats = [...new Set(entries.map((e) => e.category))].filter((c) => padded.includes(` ${norm(c)} `) || padded.includes(` ${norm(c)}s `));
    hits = entries.filter((e) => cats.includes(e.category));
  }
  hits = hits.slice(0, 6);
  const context = hits.map(describe).join("\n");
  const sources = hits.map((e) => e.name);
  const fallback = hits.length
    ? hits.map(describe).join("\n\n")
    : `I could not match that to an ingredient in the dataset (${entries.length} additives). Try naming an additive or E-number, for example "Is titanium dioxide allowed in the EU?"`;
  if (!hits.length || !env.AI) return json({ answer: fallback, sources, mode: "retrieval", note: env.AI ? undefined : "AI binding not configured" });
  try {
    const out = (await env.AI.run(MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You are a food regulatory assistant. Answer ONLY from the dataset excerpt below. If it does not contain the answer, say so. Be concise (under 120 words). Mention the market (EU or US) for every claim. End with: Demo data, not legal advice.\n\nDATASET:\n" +
            context,
        },
        { role: "user", content: q },
      ],
      max_tokens: 300,
    })) as { response?: string };
    const answer = out.response?.trim();
    if (answer) return json({ answer, sources, mode: "ai", model: MODEL });
  } catch (err) {
    console.error("Workers AI failed", err);
    return json({ answer: fallback, sources, mode: "retrieval", note: "AI unavailable: " + String(err).slice(0, 160) });
  }
  return json({ answer: fallback, sources, mode: "retrieval" });
}

async function stats(env: Env): Promise<Response> {
  const [totals, verdicts, daily, top, recent] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS checks, COALESCE(SUM(total),0) AS items, COALESCE(SUM(banned),0) AS banned, COALESCE(SUM(restricted),0) AS restricted FROM checks"),
    env.DB.prepare("SELECT market, verdict, COUNT(*) AS n FROM checks GROUP BY market, verdict"),
    env.DB.prepare("SELECT date(created_at) AS day, COUNT(*) AS n FROM checks WHERE created_at >= datetime('now', '-13 days') GROUP BY day ORDER BY day"),
    env.DB.prepare(
      "SELECT i.name, i.e_number AS eNumber, f.market, f.status, f.n FROM flag_counts f JOIN ingredients i ON i.id = f.ingredient_id ORDER BY f.n DESC LIMIT 10",
    ),
    env.DB.prepare("SELECT market, verdict, total, banned, restricted, unknown, created_at FROM checks ORDER BY id DESC LIMIT 8"),
  ]);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM ingredients").first<{ n: number }>();
  return json({
    ingredients: n?.n ?? 0,
    totals: totals.results[0],
    verdicts: verdicts.results,
    daily: daily.results,
    topFlagged: top.results,
    recent: recent.results,
  });
}

async function report(id: string, env: Env): Promise<Response> {
  if (!/^[a-z0-9]{10}$/.test(id)) throw new HttpError(404, "Report not found.");
  const r = await env.DB.prepare("SELECT id, title, ingredients, payload, created_at FROM reports WHERE id = ?").bind(id).first<{
    id: string; title: string; ingredients: string; payload: string; created_at: string;
  }>();
  if (!r) throw new HttpError(404, "Report not found.");
  return json({ id: r.id, title: r.title, ingredients: r.ingredients, createdAt: r.created_at, ...JSON.parse(r.payload) });
}

export async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  try {
    await ensureSchema(env.DB);
    const p = url.pathname;
    if (p === "/api/health") {
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM ingredients").first<{ n: number }>();
      return json({ ok: true, ingredients: n?.n ?? 0, database: "Cloudflare D1" });
    }
    if (p === "/api/ingredients" && req.method === "GET") return await listIngredients(url, env);
    if (p === "/api/stats" && req.method === "GET") return await stats(env);
    if (p === "/api/check" && req.method === "POST") return await check(req, env);
    if (p === "/api/batch" && req.method === "POST") return await batch(req, env);
    if (p === "/api/assistant" && req.method === "POST") return await assistant(req, env);
    const m = p.match(/^\/api\/reports\/([^/]+)$/);
    if (m && req.method === "GET") return await report(m[1], env);
    return json({ error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "Internal error" }, 500);
  }
}
