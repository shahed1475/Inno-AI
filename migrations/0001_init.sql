-- Inno-AI schema. Mirrors src/schema.ts.
CREATE TABLE IF NOT EXISTS ingredients (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, e_number TEXT, category TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS rules (ingredient_id INTEGER NOT NULL, market TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL, PRIMARY KEY (ingredient_id, market));
CREATE TABLE IF NOT EXISTS substitutes (ingredient_id INTEGER NOT NULL, substitute TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checks (id INTEGER PRIMARY KEY AUTOINCREMENT, market TEXT NOT NULL, verdict TEXT NOT NULL, total INTEGER NOT NULL, banned INTEGER NOT NULL, restricted INTEGER NOT NULL, unknown INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_checks_created ON checks (created_at);
CREATE TABLE IF NOT EXISTS flag_counts (ingredient_id INTEGER NOT NULL, market TEXT NOT NULL, status TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ingredient_id, market, status));
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, title TEXT NOT NULL, ingredients TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
