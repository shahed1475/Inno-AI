/**
 * EU open-data import.
 *
 * DG SANTE publishes the Union list of food additives (Annex II of Regulation
 * (EC) No 1333/2008) as open data under CC BY 4.0. If the payload carries food
 * categories and maximum levels, it replaces most of the manual rule curation
 * this project would otherwise need, so the first job is to find out what the
 * payload actually contains rather than to trust the catalogue metadata.
 *
 * Source: https://data.europa.eu/data/datasets/eu-food-additives
 * Licence: CC BY 4.0 — any UI built on this data must credit the European Commission.
 */

export const EU_DOWNLOAD =
  "https://api.datalake.sante.service.ec.europa.eu/food-additives/download?format=json&api-version=v2.0";

/* ------------------------------------------------------------------ *
 * Import
 *
 * The download is newline-delimited JSON, one object per additive per
 * food category, and it is far larger than a free Worker's CPU budget
 * for a single request. So the import runs in byte-ranged chunks: each
 * call takes a window, stops at the last complete line, and returns the
 * offset to resume from. A caller loops until `done`.
 * ------------------------------------------------------------------ */

export interface EuRecord {
  policy_item_code?: string;
  additive_e_code?: string | null;
  additive_name?: string;
  additive_synonyms?: string | null;
  additive_is_a_group?: string | null;
  group_members?: string | null;
  food_category_level?: string | null;
  food_category?: string | null;
  restriction_type?: string | null;
  restriction_value?: number | string | null;
  restriction_unit?: string | null;
  restriction_comment?: string | null;
  legislation_short?: string | null;
  legislation_oj_ref?: string | null;
  legislation_application_date?: string | null;
  fip_url?: string | null;
}

export interface EuRow {
  row_key: string; e_code: string | null; name: string; name_norm: string;
  synonyms: string | null; is_group: number; group_members: string | null;
  food_category_level: string | null; food_category: string | null;
  restriction_type: string | null; restriction_value: number | null;
  restriction_unit: string | null; restriction_comment: string | null;
  legislation_short: string | null; legislation_oj_ref: string | null;
  application_date: string | null; fip_url: string | null;
}

/** FNV-1a. Small, synchronous and stable, which is what a row key needs. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
};


/**
 * The source sends maximum levels as strings, not JSON numbers: 7,760 rules of
 * type "ML" imported with a null value because an earlier `typeof === "number"`
 * check rejected every one of them. Accept both shapes, and keep rejecting
 * anything that is not a finite number so a stray "see note" cannot become 0.
 */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
}

/** Maps one source record onto a row. Pure, so it is tested without the network. */
export function toRow(rec: EuRecord): EuRow | null {
  const name = clean(rec.additive_name);
  if (!name) return null;
  const parts = [
    rec.policy_item_code ?? "", rec.food_category_level ?? "", rec.restriction_type ?? "",
    String(rec.restriction_value ?? ""), rec.restriction_comment ?? "", rec.legislation_short ?? "",
  ].join("|");
  return {
    row_key: fnv1a(parts),
    e_code: clean(rec.additive_e_code),
    name,
    name_norm: name.toLowerCase(),
    synonyms: clean(rec.additive_synonyms),
    is_group: String(rec.additive_is_a_group ?? "").toUpperCase() === "YES" ? 1 : 0,
    group_members: clean(rec.group_members),
    food_category_level: clean(rec.food_category_level),
    food_category: clean(rec.food_category),
    restriction_type: clean(rec.restriction_type),
    restriction_value: toNumber(rec.restriction_value),
    restriction_unit: clean(rec.restriction_unit),
    restriction_comment: clean(rec.restriction_comment),
    legislation_short: clean(rec.legislation_short),
    legislation_oj_ref: clean(rec.legislation_oj_ref),
    application_date: clean(rec.legislation_application_date),
    fip_url: clean(rec.fip_url),
  };
}

/**
 * Splits a byte window into whole records. A window almost never ends on a
 * line boundary, so the trailing fragment is discarded and the caller resumes
 * from `consumed`, which keeps every chunk starting at a real record.
 */
export function parseWindow(text: string): { rows: EuRow[]; consumed: number; lines: number; bad: number } {
  const lastNl = text.lastIndexOf("\n");
  const usable = lastNl >= 0 ? text.slice(0, lastNl + 1) : "";
  const consumed = new TextEncoder().encode(usable).length;
  const rows: EuRow[] = [];
  let lines = 0, bad = 0;
  for (const line of usable.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    lines++;
    try {
      const row = toRow(JSON.parse(t) as EuRecord);
      if (row) rows.push(row);
    } catch { bad++; }
  }
  return { rows, consumed, lines, bad };
}

const INSERT = "INSERT OR REPLACE INTO eu_rules (row_key, e_code, name, name_norm, synonyms, is_group, group_members, food_category_level, food_category, restriction_type, restriction_value, restriction_unit, restriction_comment, legislation_short, legislation_oj_ref, application_date, fip_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";

export interface ImportResult {
  ok: boolean; status: number; ranged: boolean; offset: number; nextOffset: number;
  done: boolean; lines: number; rows: number; bad: number; written: number; note?: string;
}

/** Imports one window. `apply` false parses and reports without writing. */
export async function importChunk(
  db: D1Database,
  opts: { offset?: number; bytes?: number; apply?: boolean; url?: string } = {},
): Promise<ImportResult> {
  const offset = Math.max(0, opts.offset ?? 0);
  // Measured against the live endpoint: a 1 MB window parsed 477 records well
  // inside the CPU budget, so the cap is raised. The endpoint honours neither
  // Range nor any paging parameter, so each call re-reads from the start and
  // the run costs roughly (file size / window) x half the file in transfer.
  // Fewer, larger windows is therefore strictly better.
  const bytes = Math.min(Math.max(opts.bytes ?? 4_000_000, 4_096), 12_000_000);
  const url = opts.url ?? EU_DOWNLOAD;
  const res = await fetch(url, { headers: { accept: "application/json", range: `bytes=${offset}-${offset + bytes - 1}` } });
  if (res.status === 416) return { ok: true, status: 416, ranged: true, offset, nextOffset: offset, done: true, lines: 0, rows: 0, bad: 0, written: 0, note: "past end of file" };
  const ranged = res.status === 206;
  let text: string;
  if (ranged) {
    text = await res.text();
  } else {
    // The server ignored Range, so skip to the offset through the stream and
    // decode only the window. Discarding bytes costs far less than decoding them.
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let seen = 0, kept = 0;
    while (reader && kept < bytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const start = Math.max(0, offset - seen);
      seen += value.length;
      if (start < value.length) {
        const slice = value.subarray(start, Math.min(value.length, start + (bytes - kept)));
        chunks.push(slice); kept += slice.length;
      }
    }
    if (reader) await reader.cancel().catch(() => {});
    const merged = new Uint8Array(kept);
    let at = 0;
    for (const c of chunks) { merged.set(c, at); at += c.length; }
    text = new TextDecoder().decode(merged);
  }
  const { rows, consumed, lines, bad } = parseWindow(text);
  const done = consumed === 0 || text.length === 0;
  let written = 0;
  if (opts.apply && rows.length) {
    for (let i = 0; i < rows.length; i += 50) {
      const slice = rows.slice(i, i + 50);
      await db.batch(
        slice.map((r) => db.prepare(INSERT).bind(
          r.row_key, r.e_code, r.name, r.name_norm, r.synonyms, r.is_group, r.group_members,
          r.food_category_level, r.food_category, r.restriction_type, r.restriction_value,
          r.restriction_unit, r.restriction_comment, r.legislation_short, r.legislation_oj_ref,
          r.application_date, r.fip_url)),
      );
      written += slice.length;
    }
    await db.prepare("INSERT INTO meta (key, value) VALUES ('eu_import_offset', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(String(offset + consumed)).run();
  }
  return { ok: res.ok || ranged, status: res.status, ranged, offset, nextOffset: offset + consumed, done, lines, rows: rows.length, bad, written };
}

/**
 * Tries one variant of the SANTE endpoint and reports just enough to tell
 * whether it paged. Host and path prefix are fixed here rather than taken from
 * the caller, so this cannot be turned into an open proxy.
 */
export async function tryVariant(path: string, query: string): Promise<Record<string, unknown>> {
  const safePath = /^[a-z0-9/_-]{0,64}$/i.test(path) ? path : "download";
  const safeQuery = query.replace(/[^a-z0-9=&$_.,-]/gi, "").slice(0, 200);
  const url = `https://api.datalake.sante.service.ec.europa.eu/food-additives/${safePath}?api-version=v2.0&${safeQuery}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const reader = res.body?.getReader();
    const first = reader ? (await reader.read()).value : undefined;
    if (reader) await reader.cancel().catch(() => {});
    const head = first ? new TextDecoder().decode(first.subarray(0, 600)) : "";
    let firstCode: string | null = null;
    const m = head.match(/"policy_item_code"\s*:\s*"([^"]+)"/);
    if (m) firstCode = m[1];
    return { q: safeQuery || "(none)", path: safePath, status: res.status, type: res.headers.get("content-type"), firstCode, head: head.slice(0, 120) };
  } catch (e) {
    return { q: safeQuery || "(none)", path: safePath, error: String(e).slice(0, 120) };
  }
}

/**
 * Streams the whole file and counts bytes without decoding or parsing, which
 * costs almost no CPU. The size decides whether a one-pass import is possible
 * at all, and whether CSV is worth using instead of JSON.
 */
export async function measure(format: "json" | "csv" = "json"): Promise<Record<string, unknown>> {
  const url = `https://api.datalake.sante.service.ec.europa.eu/food-additives/download?format=${format}&api-version=v2.0`;
  const t0 = Date.now();
  const res = await fetch(url, { headers: { accept: "*/*" } });
  const reader = res.body?.getReader();
  let bytes = 0, chunks = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    bytes += value.length;
    chunks++;
  }
  return { format, status: res.status, bytes, mb: +(bytes / 1048576).toFixed(2), chunks, seconds: Math.round((Date.now() - t0) / 1000) };
}

export interface Coverage {
  rules: number; additives: number; categories: number;
  withNumericLimit: number; quantumSatis: number; newestRule: string | null;
  types: { type: string | null; n: number }[];
}

/**
 * Dates arrive as DD/MM/YYYY, which sorts wrongly as text: "31/12/2013" beats
 * "01/01/2024". The rearrangement below sorts them correctly without needing a
 * second column or a re-import.
 */
const AS_ISO = "substr(application_date,7,4) || substr(application_date,4,2) || substr(application_date,1,2)";

/** What the imported Union list actually covers. Public: it is the headline number. */
export async function euCoverage(db: D1Database): Promise<Coverage> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS rules, COUNT(DISTINCT name_norm) AS additives, COUNT(DISTINCT food_category_level) AS categories," +
        " SUM(CASE WHEN restriction_value IS NOT NULL THEN 1 ELSE 0 END) AS withNumericLimit," +
        " SUM(CASE WHEN restriction_type = 'quantum satis' THEN 1 ELSE 0 END) AS quantumSatis," +
        ` MAX(CASE WHEN length(application_date) = 10 THEN ${AS_ISO} END) AS newestRule FROM eu_rules`,
    )
    .first<Omit<Coverage, "types">>();
  const types = await db
    .prepare("SELECT restriction_type AS type, COUNT(*) AS n FROM eu_rules GROUP BY restriction_type ORDER BY n DESC LIMIT 8")
    .all<{ type: string | null; n: number }>();
  const iso = row?.newestRule ?? null;
  return {
    rules: row?.rules ?? 0,
    additives: row?.additives ?? 0,
    categories: row?.categories ?? 0,
    withNumericLimit: row?.withNumericLimit ?? 0,
    quantumSatis: row?.quantumSatis ?? 0,
    newestRule: iso && iso.length === 8 ? `${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6)}` : null,
    types: types.results ?? [],
  };
}
