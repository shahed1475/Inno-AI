import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const appjs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

/**
 * Loads the real page with the real app.js, with the network stubbed out.
 * DOM globals are deliberately not pulled into this project's lib: the Worker
 * types already define fetch, Request and Response, so the test uses jsdom's
 * own window instead of the ambient DOM.
 */
function page(hash = "") {
  const dom = new JSDOM(html, { url: "https://example.com/" + hash, runScripts: "outside-only" });
  const win = dom.window;
  // every screen fetches on open; return an empty but valid payload so the
  // rendering paths run rather than being skipped
  (win as unknown as { fetch: unknown }).fetch = async () => ({
    ok: true,
    json: async () => ({
      total: 0, ingredients: 0, daily: [], verdicts: [], topFlagged: [], recent: [],
      totals: { checks: 0, items: 0, banned: 0, restricted: 0 },
    }),
  });
  win.eval(appjs);
  return dom.window.document;
}

const visible = (doc: ReturnType<typeof page>, sel: string) => {
  const node = doc.querySelector(sel);
  assert.ok(node, "missing element " + sel);
  return !node.hasAttribute("hidden");
};

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
  assert.equal(current[0].getAttribute("data-tab"), "dashboard");
});

test("an unknown hash falls back to the checker instead of a blank page", () => {
  const doc = page("#nonsense");
  assert.ok(visible(doc, "#tab-checker"));
});

test("the social preview image is declared with absolute URLs", () => {
  const doc = page();
  for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    const node = doc.querySelector(sel);
    assert.ok(node, "missing " + sel);
    assert.match(node.getAttribute("content") ?? "", /^https:\/\/.+\/og\.png$/, sel + " must be absolute");
  }
});

test("the SPA fallback comes from the Worker config, not a _redirects rule", () => {
  // Workers Static Assets rejects any _redirects rule that targets /index.html:
  // it strips `/index` and `.html` before matching, so the rule re-enters itself
  // and the deploy fails with "Infinite loop detected in this rule".
  assert.throws(() => readFileSync(new URL("../public/_redirects", import.meta.url)),
    /ENOENT/, "public/_redirects must not ship; it breaks the Workers deploy");
  const cfg = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(cfg, /"not_found_handling":\s*"single-page-application"/,
    "the Worker must keep SPA handling, which is what answers /r/<id>");
});

test("hiding a section actually hides it in a browser", () => {
  // The hidden attribute is only a UA rule, display:none, and any element with
  // its own display declaration outranks it. .hero and .features are grids, so
  // without this the routing sets hidden and the browser keeps painting them.
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\[hidden\]\{display:none!important\}/,
    "styles.css must force [hidden] to win over the display rules on .hero/.features");
});
