// Idempotent schema. The same statements live in migrations/0001_init.sql for `wrangler d1 migrations apply`.
export const SCHEMA: string[] = [
  "CREATE TABLE IF NOT EXISTS ingredients (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, e_number TEXT, category TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '')",
  "CREATE TABLE IF NOT EXISTS rules (ingredient_id INTEGER NOT NULL, market TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL, PRIMARY KEY (ingredient_id, market))",
  "CREATE TABLE IF NOT EXISTS substitutes (ingredient_id INTEGER NOT NULL, substitute TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS checks (id INTEGER PRIMARY KEY AUTOINCREMENT, market TEXT NOT NULL, verdict TEXT NOT NULL, total INTEGER NOT NULL, banned INTEGER NOT NULL, restricted INTEGER NOT NULL, unknown INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE INDEX IF NOT EXISTS idx_checks_created ON checks (created_at)",
  "CREATE TABLE IF NOT EXISTS flag_counts (ingredient_id INTEGER NOT NULL, market TEXT NOT NULL, status TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ingredient_id, market, status))",
  "CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, title TEXT NOT NULL, ingredients TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  // EU Union list, imported from the European Commission open data (CC BY 4.0).
  // One row per additive per food category, carrying the limit, the citation
  // and the date the rule applied from.
  "CREATE TABLE IF NOT EXISTS eu_rules (row_key TEXT PRIMARY KEY, e_code TEXT, name TEXT NOT NULL, name_norm TEXT NOT NULL, synonyms TEXT, is_group INTEGER NOT NULL DEFAULT 0, group_members TEXT, food_category_level TEXT, food_category TEXT, restriction_type TEXT, restriction_value REAL, restriction_unit TEXT, restriction_comment TEXT, legislation_short TEXT, legislation_oj_ref TEXT, application_date TEXT, fip_url TEXT)",
  "CREATE INDEX IF NOT EXISTS idx_eu_rules_name ON eu_rules (name_norm)",
  "CREATE INDEX IF NOT EXISTS idx_eu_rules_ecode ON eu_rules (e_code)",
];
