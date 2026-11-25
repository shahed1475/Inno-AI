import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const appjs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

/** Loads the real page with the real app.js, with the network stubbed out. */
function page(hash = "") {
  const dom = new JSDOM(html, { url: "https://example.com/" + hash, runScripts: "outside-only" });
  const win = dom.window as unknown as Window & typeof globalThis & { eval(code: string): void };
  // every screen fetches; return an empty-but-valid payload so rendering is exercised
  (win as never as { fetch: unknown }).fetch = async () => ({
    ok: true,
    json: async () => ({
      total: 0, ingredients: 0, daily: [], verdicts: [], topFlagged: [], recent: [],
      totals: { checks: 0, items: 0, banned: 0, restricted: 0 },
    }),
  });
  win.eval(appjs);
  return dom.window.document;
}

const visible = (doc: Document, sel: string) => !doc.querySelector(sel)!.hasAttribute("hidden");

test("checker is the default view and shows the hero", () => {
  const doc = page();
  assert.ok(visible(doc, "#tab-checker"), "checker tab visible");
  assert.ok(visible(doc, ".hero"), "hero visible on the landing view");
  assert.ok(visible(doc, "#features"), "features visible on the landing view");
});

test("the hero and features do not follow you onto the other tabs", () => {
  for (const tab of ["dashboard", "database", "batch", "assistant"]) {
    const doc = page("#" + tab);
    assert.ok(visible(doc, "#tab-" + tab), tab + " tab visible");
    assert.ok(!visible(doc, ".hero"), "hero hidden on " + tab);
    assert.ok(!visible(doc, "#features"), "features hidden on " + tab);
  }
});

test("the open tab is marked for assistive technology", () => {
  const doc = page("#dashboard");
  const current = [...doc.querySelectorAll("#nav a[aria-current]")];
  assert.equal(current.length, 1, "exactly one nav link is current");
  assert.equal((current[0] as HTMLElement).dataset.tab, "dashboard");
});

test("an unknown hash falls back to the checker instead of a blank page", () => {
  const doc = page("#nonsense");
  assert.ok(visible(doc, "#tab-checker"));
});

test("the social preview image is declared with absolute URLs", () => {
  const doc = page();
  for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    const c = doc.querySelector(sel)!.getAttribute("content")!;
    assert.match(c, /^https:\/\/.+\/og\.png$/, sel + " must be absolute");
  }
});
