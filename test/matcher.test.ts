import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED, MARKETS } from "../src/data.ts";
import { buildEntries, evaluate, findEntry, norm, parseList } from "../src/matcher.ts";

const entries = buildEntries(
  SEED.map((s, i) => ({ id: i + 1, name: s.name, e_number: s.e ?? null, category: s.category, aliases: s.aliases.join("|") })),
  SEED.flatMap((s, i) => MARKETS.map((m) => ({ ingredient_id: i + 1, market: m, status: s.rules[m][0], note: s.rules[m][1] }))),
  SEED.flatMap((s, i) => s.subs.map((sub) => ({ ingredient_id: i + 1, substitute: sub }))),
);

test("dataset has unique names and E-numbers", () => {
  assert.equal(new Set(SEED.map((s) => s.name)).size, SEED.length);
  const e = SEED.filter((s) => s.e).map((s) => s.e);
  assert.equal(new Set(e).size, e.length);
});

test("norm strips percentages and punctuation", () => {
  assert.equal(norm("Sugar 12%"), "sugar");
  assert.equal(norm("  Fd&C Red No. 40 "), "fd&c red no 40");
});

test("parseList respects brackets and expands additive groups", () => {
  const items = parseList("flour (wheat, barley), colours (tartrazine, E110), salt, sugar 5%");
  const names = items.map((i) => i.input);
  assert.deepEqual(names, ["flour", "wheat", "barley", "tartrazine", "E110", "salt", "sugar 5%"]);
  assert.equal(items.find((i) => i.input === "tartrazine")?.via, "colours");
  assert.equal(items.find((i) => i.input === "wheat")?.soft, true);
});

test("findEntry matches names, aliases, E-numbers in any spelling", () => {
  for (const q of ["titanium dioxide", "TiO2", "E171", "e 171", "E-171", "titanium dioxide (E171)", "modified titanium dioxide powder"]) {
    assert.equal(findEntry(q, entries)?.name, "Titanium dioxide", q);
  }
  assert.equal(findEntry("red 40", entries)?.name, "Allura Red AC");
  assert.equal(findEntry("unobtainium", entries), undefined);
});

test("evaluate: EU and US differ for titanium dioxide", () => {
  const { results, summary } = evaluate(parseList("water, titanium dioxide"), entries, ["EU", "US"]);
  assert.equal(results.length, 2);
  assert.equal(summary.EU.verdict, "Not compliant");
  assert.equal(summary.US.verdict, "Compliant with conditions");
  assert.deepEqual(results[1].substitutes, ["Calcium carbonate", "Rice starch"]);
});

test("evaluate: unknown items need manual review, soft unknowns are dropped", () => {
  const a = evaluate(parseList("water, mystery gel"), entries, ["EU"]);
  assert.equal(a.summary.EU.verdict, "Needs manual review");
  const b = evaluate(parseList("flour (wheat, mystery grain)"), entries, ["EU"]);
  assert.equal(b.summary.EU.verdict, "Compliant");
  assert.deepEqual(b.results.map((r) => r.name), ["flour", "wheat"]);
});

test("evaluate: clean list is compliant and has no substitutes", () => {
  const { results, summary } = evaluate(parseList("water, sugar, citric acid, ascorbic acid"), entries, ["EU", "US"]);
  assert.equal(summary.EU.verdict, "Compliant");
  assert.ok(results.every((r) => r.substitutes.length === 0));
});

test("evaluate: cyclamate is restricted in the EU but banned in the US", () => {
  const { summary } = evaluate(parseList("sodium cyclamate"), entries, ["EU", "US"]);
  assert.equal(summary.EU.verdict, "Compliant with conditions");
  assert.equal(summary.US.verdict, "Not compliant");
});
