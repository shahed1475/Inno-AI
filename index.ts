import { MARKETS, SEED, type Market, type Status } from "./data";
import { PAGE } from "./page";

interface Env {
  DB: D1Database;
}

interface Row {
  id: number;
  name: string;
  e_number: string | null;
  category: string;
  aliases: string;
}

let ready: Promise<void> | null = null;

// Creates the tables and seeds them on first use, so no manual migration is needed.
function ensureSchema(db: D1Database): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.batch([
        db.prepare(
          "CREATE TABLE IF NOT EXISTS ingredients (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, e_number TEXT, category TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '')"
        ),
        db.prepare(
          "CREATE TABLE IF NOT EXISTS rules (ingredient_id INTEGER NOT NULL, market TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL, PRIMARY KEY (ingredient_id, market))"
        ),
        db.prepare(
          "CREATE TABLE IF NOT EXISTS substitutes (ingredient_id INTEGER NOT NULL, substitute TEXT NOT NULL)"
        ),
        db.prepare(
          "CREATE TABLE IF NOT EXISTS checks (id INTEGER PRIMARY KEY AUTOINCREMENT, market TEXT NOT NULL, verdict TEXT NOT NULL, total INTEGER NOT NULL, banned INTEGER NOT NULL, restricted INTEGER NOT NULL, unknown INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
        ),
      ]);
      const c = await db.prepare("SELECT COUNT(*) AS n FROM ingredients").first<{ n: number }>();
      if (c && c.n > 0) return;
      const stmts: D1PreparedStatement[] = [];
      SEED.forEach((s, i) => {
        const id = i + 1;
        stmts.push(
          db.prepare("INSERT INTO ingredients (id, name, e_number, category, aliases) VALUES (?, ?, ?, ?, ?)")
            .bind(id, s.name, s.e ?? null, s.category, s.aliases.join("|"))
        );
        for (const m of MARKETS) {
          stmts.push(
            db.prepare("INSERT INTO rules (ingredient_id, market, status, note) VALUES (?, ?, ?, ?)")
              .bind(id, m, s.rules[m][0], s.rules[m][1])
          );
        }
        for (const sub of s.subs) {
          stmts.push(db.prepare("INSERT INTO substitutes (ingredient_id, substitute) VALUES (?, ?)").bind(id, sub));
        }
      });
      await db.batch(stmts);
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();

const STAPLES = new Set([
  "water", "sugar", "salt", "flour", "wheat flour", "rice", "milk", "eggs", "egg", "butter", "oil", "vegetable oil",
  "sunflower oil", "olive oil", "yeast", "pork", "beef", "chicken", "dextrose", "glucose syrup", "cocoa", "vanilla",
  "carbonated water", "corn starch", "starch", "honey", "vinegar", "tomato", "onion", "garlic", "spices",
]);

interface Rule { status: Status; note: string }
interface Entry {
  row: Row;
  keys: Set<string>;
  rules: Partial<Record<Market, Rule>>;
  subs: string[];
}

async function loadEntries(db: D1Database): Promise<Entry[]> {
  const [ing, rules, subs] = await db.batch([
    db.prepare("SELECT id, name, e_number, category, aliases FROM ingredients ORDER BY name"),
    db.prepare("SELECT ingredient_id, market, status, note FROM rules"),
    db.prepare("SELECT ingredient_id, substitute FROM substitutes"),
  ]);
  const entries = new Map<number, Entry>();
  for (const r of ing.results as unknown as Row[]) {
    const keys = new Set<string>([norm(r.name)]);
    if (r.e_number) keys.add(norm(r.e_number));
    for (const a of r.aliases.split("|")) if (a) keys.add(norm(a));
    entries.set(r.id, { row: r, keys, rules: {}, subs: [] });
  }
  for (const r of rules.results as unknown as { ingredient_id: number; market: Market; status: Status; note: string }[]) {
    const e = entries.get(r.ingredient_id);
    if (e) e.rules[r.market] = { status: r.status, note: r.note };
  }
  for (const r of subs.results as unknown as { ingredient_id: number; substitute: string }[]) {
    entries.get(r.ingredient_id)?.subs.push(r.substitute);
  }
  return [...entries.values()];
}

function findEntry(item: string, entries: Entry[]): Entry | undefined {
  const n = norm(item);
  if (!n) return undefined;
  const eMatch = item.toLowerCase().match(/\be\s?-?(\d{3,4}[a-z]?)\b/);
  const eKey = eMatch ? "e" + eMatch[1] : null;
  for (const e of entries) {
    if (e.keys.has(n) || (eKey && e.keys.has(eKey))) return e;
  }
  for (const e of entries) {
    for (const k of e.keys) {
      if (k.length >= 4 && n.includes(k)) return e;
    }
  }
  return undefined;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function check(req: Request, env: Env): Promise<Response> {
  let body: { ingredients?: unknown; market?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send JSON: { ingredients, market }" }, 400);
  }
  const market = body.market as Market;
  if (!MARKETS.includes(market)) return json({ error: "market must be EU or US" }, 400);
  if (typeof body.ingredients !== "string" || !body.ingredients.trim()) {
    return json({ error: "ingredients must be a non-empty string" }, 400);
  }
  if (body.ingredients.length > 4000) return json({ error: "ingredient list too long (max 4000 characters)" }, 400);

  const items = body.ingredients.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 100);
  const entries = await loadEntries(env.DB);
  const results = items.map((item) => {
    const e = findEntry(item, entries);
    if (!e && STAPLES.has(norm(item).replace(/\([^)]*\)/g, "").trim())) {
      return {
        input: item, found: true as const, name: item, eNumber: null, category: "Plain food ingredient",
        status: "approved" as const, note: "Common food ingredient, not an additive.", substitutes: [] as string[],
      };
    }
    if (!e) return { input: item, found: false as const, status: "unknown" as const };
    const rule = e.rules[market]!;
    return {
      input: item,
      found: true as const,
      name: e.row.name,
      eNumber: e.row.e_number,
      category: e.row.category,
      status: rule.status,
      note: rule.note,
      substitutes: rule.status === "approved" ? [] : e.subs,
    };
  });
  const banned = results.filter((r) => r.status === "banned").length;
  const restricted = results.filter((r) => r.status === "restricted").length;
  const unknown = results.filter((r) => r.status === "unknown").length;
  const verdict = banned ? "Not compliant" : restricted ? "Compliant with conditions" : unknown ? "Needs manual review" : "Compliant";
  // Only anonymous counts are stored, never the ingredient text.
  await env.DB.prepare(
    "INSERT INTO checks (market, verdict, total, banned, restricted, unknown) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(market, verdict, results.length, banned, restricted, unknown).run();
  return json({ market, verdict, counts: { total: results.length, banned, restricted, unknown }, results });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/" && req.method === "GET") {
        return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.pathname === "/api/health") {
        await ensureSchema(env.DB);
        const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM ingredients").first<{ n: number }>();
        return json({ ok: true, ingredients: n?.n ?? 0, database: "Cloudflare D1" });
      }
      if (url.pathname === "/api/ingredients" && req.method === "GET") {
        await ensureSchema(env.DB);
        const entries = await loadEntries(env.DB);
        return json(
          entries.map((e) => ({ name: e.row.name, eNumber: e.row.e_number, category: e.row.category, EU: e.rules.EU, US: e.rules.US }))
        );
      }
      if (url.pathname === "/api/recent" && req.method === "GET") {
        await ensureSchema(env.DB);
        const r = await env.DB.prepare(
          "SELECT market, verdict, total, banned, restricted, unknown, created_at FROM checks ORDER BY id DESC LIMIT 10"
        ).all();
        return json(r.results);
      }
      if (url.pathname === "/api/check" && req.method === "POST") {
        await ensureSchema(env.DB);
        return await check(req, env);
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "Internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
