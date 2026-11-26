import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldNames, signals, SIGNAL_KEYS, EU_DOWNLOAD } from "../src/import/eu.ts";

test("field names are read from a truncated JSON document", () => {
  // A whole-document parse fails here; the import only ever sees a prefix.
  const fragment = '{"items":[{"eNumber":"E 200","name":"Sorbic acid","foodCategory":"01.7.1","maxLevel":1000,';
  const fields = fieldNames(fragment);
  assert.deepEqual(fields, ["items", "eNumber", "name", "foodCategory", "maxLevel"]);
});

test("a repeated key is listed once", () => {
  assert.deepEqual(fieldNames('{"a":1,"b":{"a":2},"c":3}'), ["a", "b", "c"]);
});

test("signals report which regulatory detail the payload carries", () => {
  const rich = signals(["eNumber", "foodCategory", "maxLevel", "restrictionText"]);
  assert.ok(rich.includes("foodCategory"), "food category detected");
  assert.ok(rich.includes("maxLevel"), "maximum level detected");
  // A names-only payload is the case that would mean curation is still manual.
  assert.deepEqual(signals(["id", "name", "synonyms"]), []);
});

test("the download URL is the documented open-data endpoint", () => {
  assert.match(EU_DOWNLOAD, /^https:\/\/api\.datalake\.sante\.service\.ec\.europa\.eu\/food-additives\/download\?/);
  assert.ok(SIGNAL_KEYS.length > 0);
});

import { toRow, parseWindow, fnv1a } from "../src/import/eu.ts";

const SAMPLE = {
  policy_item_code: "POL-FAD-IMPORT-2982",
  additive_e_code: "Group II",
  additive_name: "Group II, Colours at <em>quantum satis</em>",
  additive_is_a_group: "YES",
  group_members: "POL-FAD-IMPORT-2986,POL-FAD-IMPORT-2999",
  food_category_level: "1.5",
  food_category: "dehydrated milk as defined by directive 2001/114/ec",
  restriction_type: "quantum satis",
  restriction_value: null,
  restriction_unit: null,
  restriction_comment: "except unflavoured products",
  legislation_short: "(EU) No 2018/1497",
  legislation_oj_ref: "OJ L 253, 09/10/2018 p.36",
  legislation_application_date: "29/10/2018",
  fip_url: "https://ec.europa.eu/food/food-feed-portal/screen/food-additives/search/details/POL-FAD-IMPORT-2982",
};

test("a source record maps onto a row, with markup stripped", () => {
  const row = toRow(SAMPLE)!;
  assert.equal(row.name, "Group II, Colours at quantum satis", "the <em> tags are removed");
  assert.equal(row.is_group, 1);
  assert.equal(row.food_category_level, "1.5");
  assert.equal(row.restriction_type, "quantum satis");
  assert.equal(row.restriction_comment, "except unflavoured products");
  assert.equal(row.legislation_short, "(EU) No 2018/1497");
  assert.equal(row.application_date, "29/10/2018");
});

test("the row key separates two rules that differ only by legislation", () => {
  const a = toRow(SAMPLE)!;
  const b = toRow({ ...SAMPLE, legislation_short: "(EU) No 1819/2020" })!;
  assert.notEqual(a.row_key, b.row_key, "a later amendment is a different row, not an overwrite");
  assert.equal(toRow(SAMPLE)!.row_key, a.row_key, "the same record always hashes the same");
});

test("a record with no name is skipped rather than stored blank", () => {
  assert.equal(toRow({ ...SAMPLE, additive_name: "   " }), null);
});

test("a window stops at the last complete line and reports where to resume", () => {
  const line = JSON.stringify(SAMPLE);
  const text = line + "\n" + line + "\n" + line.slice(0, 40);
  const out = parseWindow(text);
  assert.equal(out.rows.length, 2, "the truncated third record is not parsed");
  assert.equal(out.lines, 2);
  assert.equal(out.bad, 0);
  assert.equal(out.consumed, new TextEncoder().encode(line + "\n" + line + "\n").length,
    "resume offset lands exactly on the start of the partial line");
});

test("a window with no newline consumes nothing, so the caller can widen it", () => {
  const out = parseWindow('{"additive_name":"no newline here"');
  assert.equal(out.consumed, 0);
  assert.equal(out.rows.length, 0);
});

test("a malformed line is counted, not thrown", () => {
  const out = parseWindow('{"additive_name":"Sorbic acid"}\nnot json\n');
  assert.equal(out.rows.length, 1);
  assert.equal(out.bad, 1);
});

test("the hash is stable and hex", () => {
  assert.equal(fnv1a("abc"), fnv1a("abc"));
  assert.match(fnv1a("abc"), /^[0-9a-f]{8}$/);
});
