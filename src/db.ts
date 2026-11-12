import { DATASET_VERSION, MARKETS, SEED, type Market, type Status } from "./data.ts";
import { SCHEMA } from "./schema.ts";
import { buildEntries, type Entry } from "./matcher.ts";

let ready: Promise<void> | null = null;

const chunk = <T>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

/** Creates the tables and syncs the dataset on first use, so no manual migration is needed. */
export function ensureSchema(db: D1Database): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.batch(SCHEMA.map((s) => db.prepare(s)));
      const v = await db.prepare("SELECT value FROM meta WHERE key = 'dataset_version'").first<{ value: string }>();
      if (v?.value === DATASET_VERSION) return;
      const stmts: D1PreparedStatement[] = [];
      for (const s of SEED) {
        stmts.push(
          db
            .prepare(
              "INSERT INTO ingredients (name, e_number, category, aliases) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET e_number = excluded.e_number, category = excluded.category, aliases = excluded.aliases",
            )
            .bind(s.name, s.e ?? null, s.category, s.aliases.join("|")),
        );
        for (const m of MARKETS) {
          stmts.push(
            db
              .prepare(
                "INSERT OR REPLACE INTO rules (ingredient_id, market, status, note) VALUES ((SELECT id FROM ingredients WHERE name = ?), ?, ?, ?)",
              )
              .bind(s.name, m, s.rules[m][0], s.rules[m][1]),
          );
        }
        stmts.push(db.prepare("DELETE FROM substitutes WHERE ingredient_id = (SELECT id FROM ingredients WHERE name = ?)").bind(s.name));
        for (const sub of s.subs) {
          stmts.push(
            db.prepare("INSERT INTO substitutes (ingredient_id, substitute) VALUES ((SELECT id FROM ingredients WHERE name = ?), ?)").bind(s.name, sub),
          );
        }
      }
      for (const part of chunk(stmts, 100)) await db.batch(part);
      await db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('dataset_version', ?)").bind(DATASET_VERSION).run();
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

export async function loadEntries(db: D1Database): Promise<Entry[]> {
  const [ing, rules, subs] = await db.batch([
    db.prepare("SELECT id, name, e_number, category, aliases FROM ingredients ORDER BY name"),
    db.prepare("SELECT ingredient_id, market, status, note FROM rules"),
    db.prepare("SELECT ingredient_id, substitute FROM substitutes"),
  ]);
  return buildEntries(
    ing.results as never,
    rules.results as unknown as { ingredient_id: number; market: Market; status: Status; note: string }[],
    subs.results as never,
  );
}
