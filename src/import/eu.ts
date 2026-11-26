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
