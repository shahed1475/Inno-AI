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

export interface ProbeResult {
  url: string;
  ok: boolean;
  status: number;
  contentType: string | null;
  contentLength: string | null;
  bytesRead: number;
  /** Distinct JSON keys seen in the prefix, in first-seen order. */
  fields: string[];
  /** Raw head of the body, so an unexpected shape or an error page is visible. */
  head: string;
}

/**
 * Distinct object keys in a JSON fragment, in the order they first appear.
 * Works on a truncated document, which a whole-document parse cannot.
 */
export function fieldNames(jsonFragment: string, limit = 60): string[] {
  const seen: string[] = [];
  for (const m of jsonFragment.matchAll(/"([^"\\]{1,64})"\s*:/g)) {
    const key = m[1];
    if (!seen.includes(key)) seen.push(key);
    if (seen.length >= limit) break;
  }
  return seen;
}

/** Keys that would mean the download carries real regulatory detail, not just names. */
export const SIGNAL_KEYS = ["category", "foodCategory", "maxLevel", "maximumLevel", "restriction", "condition", "legal", "annex", "eNumber", "e_number"];

/** Which signal keys are present, case-insensitively, in a list of field names. */
export function signals(fields: string[]): string[] {
  const lower = fields.map((f) => f.toLowerCase());
  return SIGNAL_KEYS.filter((s) => lower.some((f) => f.includes(s.toLowerCase())));
}

/**
 * Reads only the first `maxBytes` of the download. The full file may be large,
 * and a Worker request has little CPU and memory to spare; the head is enough
 * to learn the shape.
 */
export async function probeEu(url: string = EU_DOWNLOAD, maxBytes = 40_000): Promise<ProbeResult> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  const reader = res.body?.getReader();
  while (reader && bytesRead < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    bytesRead += value.length;
  }
  if (reader) await reader.cancel().catch(() => {});
  const merged = new Uint8Array(bytesRead);
  let at = 0;
  for (const c of chunks) { merged.set(c, at); at += c.length; }
  const head = new TextDecoder().decode(merged);
  return {
    url,
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get("content-type"),
    contentLength: res.headers.get("content-length"),
    bytesRead,
    fields: fieldNames(head),
    head: head.slice(0, 4000),
  };
}

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
  restriction_value?: number | null;
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
    restriction_value: typeof rec.restriction_value === "number" ? rec.restriction_value : null,
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
  const bytes = Math.min(Math.max(opts.bytes ?? 196_608, 4_096), 1_000_000);
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
