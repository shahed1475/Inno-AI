"use strict";
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const MARKET_NAMES = { EU: "European Union", US: "United States" };
  const EXAMPLES = [
    "Wheat flour, sugar, vegetable oil, titanium dioxide (E171), potassium bromate, tartrazine, sodium benzoate, citric acid, water",
    "Carbonated water, sugar, caramel colour IV, aspartame, phosphoric acid, natural flavourings, Red 40",
    "Beef, water, salt, sodium nitrite (E250), dextrose, rosemary extract, ascorbic acid, spices",
    "Sugar, glucose syrup, gelatin, colours (carmoisine, brilliant blue FCF, E104), citric acid, polysorbate 80, cyclamate",
  ];
  let exIdx = 0;
  let last = null; // last checker response, for export and sharing

  // ---------- helpers ----------
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "css") n.style.cssText = v; // CSSOM is allowed under the strict CSP, style attributes are not
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }
  const pill = (s) => el("span", { class: "pill " + s }, s);
  async function api(path, body) {
    const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
  }
  const show = (n, on = true) => { n.hidden = !on; };
  const picked = (name) => $$('input[name="' + name + '"]:checked').map((i) => i.value);
  function showError(id, msg) { const n = $(id); n.textContent = msg || ""; show(n, !!msg); }
  function download(name, text, type) {
    const a = el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a); a.click(); a.remove();
  }
  const csvCell = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const toneOf = (v) => ({ "Compliant": "good", "Compliant with conditions": "cond", "Not compliant": "bad" }[v] || "rev");

  // ---------- tabs ----------
  const TABS = ["checker", "batch", "assistant", "database", "dashboard"];
  const loaded = {};
  function route() {
    let tab = location.hash.slice(1);
    if (!TABS.includes(tab)) tab = "checker";
    TABS.forEach((t) => show($("#tab-" + t), t === tab));
    $$("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
    if (tab === "database" && !loaded.db) { loaded.db = true; loadDb(""); }
    if (tab === "dashboard") loadDashboard();
    if (tab === "assistant" && !loaded.chat) { loaded.chat = true; initChat(); }
  }
  addEventListener("hashchange", route);

  // ---------- checker ----------
  function renderResults(data, target) {
    target.replaceChildren();
    const markets = data.markets;
    const cards = el("div", { class: "verdicts" });
    for (const m of markets) {
      const s = data.summary[m], c = s.counts;
      cards.append(el("div", { class: "vcard " + toneOf(s.verdict) },
        el("h3", {}, MARKET_NAMES[m]), el("div", { class: "v" }, s.verdict),
        el("div", { class: "counts" },
          el("span", {}, c.approved + " approved"), el("span", {}, c.restricted + " restricted"),
          el("span", {}, c.banned + " banned"), el("span", {}, c.unknown + " unknown"))));
    }
    const onlyFlagged = el("input", { type: "checkbox", id: "only-flagged" });
    const actions = el("div", { class: "actions" },
      el("button", { class: "btn sm", onclick: () => exportCsv(data) }, "Download CSV"),
      el("button", { class: "btn sm", onclick: () => window.print() }, "Print"),
      data.report ? null : el("button", { class: "btn sm", id: "share-btn", onclick: shareReport }, "Save and share link"),
      el("label", { class: "chk" }, onlyFlagged, "Only show issues"));
    const tbody = el("tbody");
    const head = el("tr", {}, el("th", {}, "Ingredient"), ...markets.map((m) => el("th", {}, m)), el("th", {}, "Substitution ideas"));
    for (const r of data.results) {
      const flagged = markets.some((m) => r.rules[m].status !== "approved");
      const tr = el("tr", { "data-flag": flagged ? "1" : "0" },
        el("td", {},
          el("div", { class: "nm" }, r.name, r.eNumber ? " (" + r.eNumber + ")" : ""),
          el("div", { class: "sub" }, r.category + (r.via ? " · listed under " + r.via : "") + (r.found && r.input.toLowerCase() !== r.name.toLowerCase() ? " · written as “" + r.input + "”" : ""))),
        ...markets.map((m) => el("td", {}, pill(r.rules[m].status), el("span", { class: "note" }, r.rules[m].note))),
        el("td", {}, r.substitutes.length ? el("div", { class: "chips" }, r.substitutes.map((s) => el("span", { class: "chip" }, s))) : el("span", { class: "mute" }, "–")));
      tbody.append(tr);
    }
    onlyFlagged.addEventListener("change", () => $$("tr[data-flag]", tbody).forEach((tr) => { tr.hidden = onlyFlagged.checked && tr.dataset.flag === "0"; }));
    target.append(cards, el("div", { class: "card" }, actions, el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, head), tbody))));
    show(target);
  }
  function exportCsv(data) {
    const rows = [["Ingredient", "E-number", "Category", ...data.markets.flatMap((m) => [m + " status", m + " note"]), "Substitutes"]];
    for (const r of data.results) rows.push([r.name, r.eNumber, r.category, ...data.markets.flatMap((m) => [r.rules[m].status, r.rules[m].note]), r.substitutes.join("; ")]);
    download("inno-ai-compliance.csv", rows.map((r) => r.map(csvCell).join(",")).join("\n"), "text/csv");
  }
  async function runCheck(save) {
    const markets = picked("mk");
    if (!markets.length) return showError("#error", "Pick at least one market.");
    const ingredients = $("#ing").value;
    if (!ingredients.trim()) return showError("#error", "Paste an ingredient list first.");
    showError("#error", "");
    const btn = $("#go"); btn.disabled = true; btn.textContent = "Checking…";
    try {
      const body = { ingredients, markets };
      if (save) { body.save = true; body.title = (prompt("Name this report", "My product") || "").trim(); }
      last = await api("/api/check", body);
      renderResults(last, $("#results"));
      if (last.report) {
        const url = location.origin + "/r/" + last.report.id;
        history.replaceState(null, "", "/r/" + last.report.id);
        try { await navigator.clipboard.writeText(url); } catch {}
        const n = $("#report-banner"); n.textContent = "Saved. Shareable link (copied): " + url; show(n);
      }
    } catch (e) { showError("#error", e.message); }
    finally { btn.disabled = false; btn.textContent = "Check compliance"; }
  }
  function shareReport() {
    if (!confirm("This saves the ingredient list and results behind a private link anyone with the link can open. Continue?")) return;
    runCheck(true);
  }
  $("#go").addEventListener("click", () => runCheck(false));
  $("#example").addEventListener("click", () => { $("#ing").value = EXAMPLES[exIdx++ % EXAMPLES.length]; });

  // ---------- label scanner (in-browser OCR) ----------
  let tessPromise;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    tessPromise ??= new Promise((res, rej) => {
      const s = el("script", { src: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js" });
      s.onload = () => res(window.Tesseract); s.onerror = () => rej(new Error("Could not load the OCR engine."));
      document.head.append(s);
    });
    return tessPromise;
  }
  function extractIngredients(text) {
    const flat = text.replace(/\r/g, "").replace(/-\n/g, "").replace(/\n+/g, " ").replace(/\s+/g, " ");
    const m = flat.match(/ingredients?\s*[:;.\-]?\s*(.+?)(?:\s*(?:allergen|contains|may contain|nutrition|storage|best before|manufactured|produced|net (?:wt|weight)|distributed)\b|$)/i);
    return (m ? m[1] : flat).replace(/[|_]/g, " ").trim().replace(/\.$/, "");
  }
  $("#scan-file").addEventListener("change", async (ev) => {
    const file = ev.target.files[0]; ev.target.value = "";
    if (!file) return;
    const st = $("#scan-status"); show(st);
    st.textContent = "Loading the OCR engine…";
    try {
      const T = await loadTesseract();
      const worker = await T.createWorker("eng", 1, { logger: (m) => { if (m.status === "recognizing text") st.textContent = "Reading label… " + Math.round(m.progress * 100) + "%"; } });
      const { data } = await worker.recognize(file);
      await worker.terminate();
      const text = extractIngredients(data.text);
      if (!text) throw new Error("No text found. Try a sharper, well-lit photo.");
      $("#ing").value = text;
      st.textContent = "Label read. Review the ingredients below, fix any OCR mistakes, then check compliance.";
    } catch (e) { st.textContent = ""; show(st, false); showError("#error", e.message); }
  });

  // ---------- batch ----------
  function parseCsv(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  $("#csv-file").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; ev.target.value = "";
    if (!f) return;
    let rows = parseCsv(await f.text());
    if (rows.length && /^(product|name)/i.test(rows[0][0] || "") && /ingredient/i.test(rows[0][1] || "")) rows = rows.slice(1);
    $("#batch-in").value = rows.map((r) => (r[0] || "").trim() + " | " + (r[1] || "").trim()).join("\n");
  });
  $("#batch-go").addEventListener("click", async () => {
    const markets = picked("bmk");
    if (!markets.length) return showError("#batch-error", "Pick at least one market.");
    const rows = $("#batch-in").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf("|");
      return i < 0 ? { name: "", ingredients: l } : { name: l.slice(0, i).trim(), ingredients: l.slice(i + 1).trim() };
    }).filter((r) => r.ingredients);
    if (!rows.length) return showError("#batch-error", "Add at least one product line.");
    showError("#batch-error", "");
    const btn = $("#batch-go"); btn.disabled = true; btn.textContent = "Running…";
    try {
      const data = await api("/api/batch", { markets, rows });
      const out = $("#batch-out"); out.replaceChildren();
      const tbody = el("tbody");
      for (const r of data.rows) {
        tbody.append(el("tr", {},
          el("td", {}, el("div", { class: "nm" }, r.name)),
          ...data.markets.map((m) => el("td", {}, el("span", { class: "pill " + ({ good: "approved", cond: "restricted", bad: "banned", rev: "unknown" })[toneOf(r.summary[m].verdict)] }, r.summary[m].verdict))),
          el("td", {}, r.flagged.length ? el("div", { class: "chips" }, r.flagged.map((f) => el("span", { class: "chip" }, f.name + (f.eNumber ? " " + f.eNumber : "")))) : el("span", { class: "mute" }, "None"))));
      }
      const csv = () => {
        const lines = [["Product", ...data.markets.map((m) => m + " verdict"), "Flagged"]];
        for (const r of data.rows) lines.push([r.name, ...data.markets.map((m) => r.summary[m].verdict), r.flagged.map((f) => f.name).join("; ")]);
        download("inno-ai-batch.csv", lines.map((l) => l.map(csvCell).join(",")).join("\n"), "text/csv");
      };
      out.append(el("div", { class: "card" }, el("div", { class: "actions" }, el("button", { class: "btn sm", onclick: csv }, "Download CSV")),
        el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Product"), ...data.markets.map((m) => el("th", {}, m)), el("th", {}, "Flagged ingredients"))), tbody))));
      show(out);
    } catch (e) { showError("#batch-error", e.message); }
    finally { btn.disabled = false; btn.textContent = "Run batch"; }
  });

  // ---------- assistant ----------
  const QUESTIONS = ["Is titanium dioxide allowed in the EU?", "What can replace Red 40?", "Which flour improvers are banned?", "Is cyclamate legal in the US?"];
  function initChat() {
    const log = $("#chat-log");
    const add = (cls, text, foot) => { const m = el("div", { class: "msg " + cls }, text, foot ? el("small", {}, foot) : null); log.append(m); log.scrollTop = log.scrollHeight; return m; };
    add("bot", "Hi! Ask about an additive or E-number and I will answer from the compliance database.");
    $("#suggest").append(...QUESTIONS.map((q) => el("button", { class: "chip", type: "button", onclick: () => ask(q) }, q)));
    async function ask(q) {
      add("me", q); const wait = add("bot", "Thinking…");
      try {
        const d = await api("/api/assistant", { question: q });
        wait.remove();
        add("bot", d.answer, (d.sources.length ? "Sources: " + d.sources.join(", ") + " · " : "") + (d.mode === "ai" ? "Workers AI" : "database lookup"));
      } catch (e) { wait.textContent = e.message; }
    }
    $("#chat-form").addEventListener("submit", (e) => {
      e.preventDefault(); const q = $("#chat-in").value.trim(); if (!q) return; $("#chat-in").value = ""; ask(q);
    });
  }

  // ---------- database ----------
  let dbTimer;
  async function loadDb(q) {
    try {
      const d = await api("/api/ingredients?q=" + encodeURIComponent(q));
      $("#db-count").textContent = d.ingredients.length + " of " + d.total;
      const tb = $("#db-table tbody"); tb.replaceChildren();
      if (!d.ingredients.length) tb.append(el("tr", {}, el("td", { colspan: 4, class: "empty" }, "No ingredients match.")));
      for (const i of d.ingredients) {
        tb.append(el("tr", {},
          el("td", {}, el("div", { class: "nm" }, i.name, i.eNumber ? " (" + i.eNumber + ")" : ""), i.substitutes.length ? el("div", { class: "sub" }, "Alternatives: " + i.substitutes.join(", ")) : null),
          el("td", {}, i.category),
          ...["EU", "US"].map((m) => el("td", {}, pill(i[m].status), el("span", { class: "note" }, i[m].note)))));
      }
    } catch (e) { $("#db-count").textContent = e.message; }
  }
  $("#db-q").addEventListener("input", (e) => { clearTimeout(dbTimer); dbTimer = setTimeout(() => loadDb(e.target.value), 200); });

  // ---------- dashboard ----------
  async function loadDashboard() {
    try {
      const d = await api("/api/stats");
      const t = d.totals;
      const tiles = $("#tiles"); tiles.replaceChildren(
        ...[[t.checks, "compliance checks run"], [t.items, "ingredients analysed"], [Number(t.banned) + Number(t.restricted), "issues flagged"], [d.ingredients, "additives in the database"]]
          .map(([n, l]) => el("div", { class: "tile" }, el("b", {}, Number(n).toLocaleString()), el("span", {}, l))));
      // 14-day chart with zero-filled days
      const byDay = Object.fromEntries(d.daily.map((r) => [r.day, r.n]));
      const days = [];
      for (let i = 13; i >= 0; i--) { const dt = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push([dt, byDay[dt] || 0]); }
      const max = Math.max(1, ...days.map((x) => x[1]));
      $("#chart").replaceChildren(...days.map(([dt, n]) => el("div", { class: "bar-col", title: dt + ": " + n }, el("i", { css: "height:" + Math.round((n / max) * 100) + "%" }), el("span", {}, dt.slice(8)))));
      // outcomes
      const out = $("#outcomes"); out.replaceChildren();
      for (const m of ["EU", "US"]) {
        const rows = d.verdicts.filter((v) => v.market === m); const tot = rows.reduce((a, b) => a + b.n, 0);
        const get = (name) => rows.find((r) => r.verdict === name)?.n || 0;
        const seg = [["Compliant", "s-good"], ["Compliant with conditions", "s-cond"], ["Not compliant", "s-bad"], ["Needs manual review", "s-rev"]];
        out.append(el("div", {}, el("b", {}, MARKET_NAMES[m]), el("span", { class: "mute" }, "  " + tot + " checks"),
          el("div", { class: "stack" }, seg.map(([n, c]) => el("i", { class: c, css: "width:" + (tot ? (get(n) / tot) * 100 : 0) + "%", title: n + ": " + get(n) })))));
      }
      out.append(el("div", { class: "legend" }, el("span", {}, "● compliant"), el("span", {}, "● conditions"), el("span", {}, "● not compliant"), el("span", {}, "● review")));
      const top = $("#top"); top.replaceChildren(...(d.topFlagged.length ? d.topFlagged.map((r) => el("li", {}, r.name + " ", pill(r.status), " " + r.market + " · " + r.n + "×")) : [el("li", { class: "empty" }, "Nothing flagged yet.")]));
      $("#recent tbody").replaceChildren(...d.recent.map((r) => el("tr", {}, el("td", {}, r.created_at), el("td", {}, r.market), el("td", {}, r.verdict), el("td", {}, r.total + " (" + r.banned + " banned, " + r.restricted + " restricted)"))));
    } catch (e) { $("#tiles").replaceChildren(el("div", { class: "error" }, e.message)); }
  }

  // ---------- shared report ----------
  async function openReport(id) {
    location.hash = "#checker";
    try {
      const r = await api("/api/reports/" + id);
      $("#ing").value = r.ingredients;
      $$('input[name="mk"]').forEach((i) => { i.checked = r.markets.includes(i.value); });
      last = r; renderResults(r, $("#results"));
      const n = $("#report-banner"); n.textContent = "Shared report “" + r.title + "” saved " + r.createdAt + " UTC."; show(n);
    } catch (e) { showError("#error", e.message); }
  }

  const m = location.pathname.match(/^\/r\/([a-z0-9]{10})$/);
  if (m) openReport(m[1]);
  route();
})();
