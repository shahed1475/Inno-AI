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
