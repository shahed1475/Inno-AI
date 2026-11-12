import type { Market, Status } from "./data.ts";

export type RuleStatus = Status | "unknown";
export type Verdict = "Compliant" | "Compliant with conditions" | "Needs manual review" | "Not compliant";

export interface Rule {
  status: Status;
  note: string;
}

export interface Entry {
  id: number;
  name: string;
  eNumber: string | null;
  category: string;
  keys: Set<string>;
  rules: Partial<Record<Market, Rule>>;
  subs: string[];
}

export interface Item {
  input: string;
  /** Group label the item was listed under, e.g. "colour" in "colour (tartrazine)". */
  via?: string;
  /** Soft items come from inside brackets of a non-additive; they are dropped if unknown. */
  soft?: boolean;
}

export interface MarketRule {
  status: RuleStatus;
  note: string;
}

export interface IngredientResult {
  input: string;
  via?: string;
  found: boolean;
  plain: boolean;
  name: string;
  eNumber: string | null;
  category: string;
  rules: Record<Market, MarketRule>;
  substitutes: string[];
  entryId: number | null;
}

export interface MarketSummary {
  verdict: Verdict;
  counts: { total: number; approved: number; restricted: number; banned: number; unknown: number };
}

const STAPLES = new Set([
  "water", "sugar", "salt", "flour", "wheat flour", "wholemeal flour", "rice", "rice flour", "milk", "skimmed milk",
  "milk powder", "eggs", "egg", "egg yolk", "butter", "oil", "vegetable oil", "sunflower oil", "palm oil", "rapeseed oil",
  "olive oil", "yeast", "pork", "beef", "chicken", "dextrose", "glucose syrup", "glucose", "fructose", "cocoa",
  "cocoa butter", "cocoa powder", "vanilla", "carbonated water", "corn starch", "maize starch", "starch", "honey",
  "vinegar", "tomato", "tomato paste", "onion", "garlic", "spices", "spice", "herbs", "wheat", "barley", "oats", "rye",
  "maize", "soya", "soy", "almonds", "hazelnuts", "peanuts", "lemon juice", "orange juice", "malt extract",
  "maltodextrin", "cream", "cheese", "yoghurt", "yogurt", "pepper", "black pepper", "paprika", "cinnamon", "lemon",
  "wheat gluten", "oat flour", "potato starch", "tapioca starch", "flavouring", "flavourings", "natural flavouring",
  "natural flavourings", "flavor", "flavors", "natural flavors",
]);

/** Words that label a group of additives rather than naming one. */
const GROUP_LABELS = new Set([
  "colour", "colours", "color", "colors", "preservative", "preservatives", "antioxidant", "antioxidants",
  "emulsifier", "emulsifiers", "sweetener", "sweeteners", "stabiliser", "stabilisers", "stabilizer", "stabilizers",
  "thickener", "thickeners", "acidity regulator", "acidity regulators", "flavour enhancer", "flavour enhancers",
  "flavor enhancer", "raising agent", "raising agents", "anti caking agent", "anti caking agents", "gelling agent",
  "colouring", "coloring", "additives", "e numbers", "acid", "acids",
]);

export const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, " ")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Split on commas, semicolons and newlines that are not inside brackets. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || ch === ";" || ch === "\n")) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function parseList(text: string): Item[] {
  const items: Item[] = [];
  for (const raw of splitTopLevel(text)) {
    const m = raw.match(/^([^([]*)[([](.*)[)\]]\s*\.?$/s);
    if (!m) {
      items.push({ input: raw.replace(/^[.\s]+|[.\s]+$/g, "") });
      continue;
    }
    const outer = m[1].trim();
    const inner = splitTopLevel(m[2]);
    const group = GROUP_LABELS.has(norm(outer));
    if (group && inner.length) {
      for (const i of inner) items.push({ input: i, via: outer });
    } else if (inner.length <= 1) {
      items.push({ input: raw });
    } else {
      if (outer) items.push({ input: outer });
      for (const i of inner) items.push({ input: i, via: outer, soft: true });
    }
  }
  return items.filter((i) => i.input);
}

export function buildEntries(
  ingredients: { id: number; name: string; e_number: string | null; category: string; aliases: string }[],
  rules: { ingredient_id: number; market: Market; status: Status; note: string }[],
  subs: { ingredient_id: number; substitute: string }[],
): Entry[] {
  const map = new Map<number, Entry>();
  for (const r of ingredients) {
    const keys = new Set<string>([norm(r.name)]);
    if (r.e_number) keys.add(norm(r.e_number));
    for (const a of r.aliases.split("|")) if (a) keys.add(norm(a));
    map.set(r.id, { id: r.id, name: r.name, eNumber: r.e_number, category: r.category, keys, rules: {}, subs: [] });
  }
  for (const r of rules) {
    const e = map.get(r.ingredient_id);
    if (e) e.rules[r.market] = { status: r.status, note: r.note };
  }
  for (const r of subs) map.get(r.ingredient_id)?.subs.push(r.substitute);
  return [...map.values()];
}

export function isStaple(item: string): boolean {
  return STAPLES.has(norm(item));
}

export function findEntry(item: string, entries: Entry[]): Entry | undefined {
  const n = norm(item);
  if (!n) return undefined;
  const eMatch = item.toLowerCase().match(/\be\s?-?(\d{3,4}[a-z]?)\b/);
  const eKey = eMatch ? "e" + eMatch[1] : null;
  for (const e of entries) {
    if (e.keys.has(n) || (eKey && e.keys.has(eKey))) return e;
  }
  if (isStaple(item)) return undefined;
  // Fall back to the longest additive name contained in the text, e.g. "modified titanium dioxide powder".
  let best: { e: Entry; len: number } | undefined;
  const padded = ` ${n} `;
  for (const e of entries) {
    for (const k of e.keys) {
      if (k.length >= 4 && padded.includes(` ${k} `) && (!best || k.length > best.len)) best = { e, len: k.length };
    }
  }
  return best?.e;
}

const unknownRule: MarketRule = { status: "unknown", note: "Not in the demonstration dataset. Check this one manually." };

export function evaluate(items: Item[], entries: Entry[], markets: Market[]) {
  const results: IngredientResult[] = [];
  for (const item of items) {
    const e = findEntry(item.input, entries);
    if (e) {
      const rules = {} as Record<Market, MarketRule>;
      for (const m of ["EU", "US"] as Market[]) rules[m] = e.rules[m] ?? unknownRule;
      const flagged = markets.some((m) => rules[m].status === "banned" || rules[m].status === "restricted");
      results.push({
        input: item.input, via: item.via, found: true, plain: false, name: e.name, eNumber: e.eNumber,
        category: e.category, rules, substitutes: flagged ? e.subs : [], entryId: e.id,
      });
    } else if (isStaple(item.input)) {
      const ok: MarketRule = { status: "approved", note: "Common food ingredient, not an additive." };
      results.push({
        input: item.input, via: item.via, found: true, plain: true, name: item.input, eNumber: null,
        category: "Plain food ingredient", rules: { EU: ok, US: ok }, substitutes: [], entryId: null,
      });
    } else if (!item.soft) {
      results.push({
        input: item.input, via: item.via, found: false, plain: false, name: item.input, eNumber: null,
        category: "Unrecognised", rules: { EU: unknownRule, US: unknownRule }, substitutes: [], entryId: null,
      });
    }
  }
  const summary = {} as Record<Market, MarketSummary>;
  for (const m of markets) summary[m] = summarise(results, m);
  return { results, summary };
}

export function summarise(results: IngredientResult[], market: Market): MarketSummary {
  const c = { total: results.length, approved: 0, restricted: 0, banned: 0, unknown: 0 };
  for (const r of results) c[r.rules[market].status]++;
  const verdict: Verdict = c.banned
    ? "Not compliant"
    : c.restricted
      ? "Compliant with conditions"
      : c.unknown
        ? "Needs manual review"
        : "Compliant";
  return { verdict, counts: c };
}
