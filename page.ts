// Single-page UI, served by the Worker. The client script avoids template literals.
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inno-AI: Ingredient Compliance Checker</title>
<meta name="description" content="Check food ingredient lists against EU and US additive rules and get substitution ideas. Demo built on Cloudflare Workers and D1.">
<style>
:root{--bg:#0b1020;--card:#121a30;--line:#24304f;--text:#e8ecf8;--mute:#9aa6c7;--ok:#3ecf8e;--warn:#f5b84a;--bad:#ff6b6b;--accent:#6ea8ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:880px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;margin:0 0 4px}p.sub{color:var(--mute);margin:0 0 24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:18px}
label{display:block;font-weight:600;margin-bottom:6px}
textarea{width:100%;min-height:120px;background:#0d1428;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px;font:inherit;resize:vertical}
select,button{font:inherit;border-radius:8px;border:1px solid var(--line);padding:9px 14px;background:#0d1428;color:var(--text)}
button.primary{background:var(--accent);color:#06101f;border-color:var(--accent);font-weight:700;cursor:pointer}
button.link{background:none;border:none;color:var(--accent);padding:0;cursor:pointer;text-decoration:underline}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px}
.verdict{font-size:20px;font-weight:800}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
table{width:100%;border-collapse:collapse;margin-top:10px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mute);font-weight:600;font-size:13px}
.pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:700;border:1px solid currentColor}
small,.mute{color:var(--mute)}footer{color:var(--mute);font-size:13px;margin-top:28px}
a{color:var(--accent)}
</style>
</head>
<body>
<main>
<h1>Inno-AI Ingredient Compliance Checker</h1>
<p class="sub">Paste an ingredient list, pick a market, and see which additives are approved, restricted or banned, with substitution ideas.</p>

<div class="card">
<label for="ing">Ingredients (comma separated, names or E-numbers)</label>
<textarea id="ing">Wheat flour, sugar, titanium dioxide (E171), potassium bromate, tartrazine, citric acid, sodium benzoate, water</textarea>
<div class="row">
<label for="mkt" style="margin:0">Market</label>
<select id="mkt"><option value="EU">European Union</option><option value="US">United States</option></select>
<button class="primary" id="go">Check compliance</button>
<button class="link" id="ex">Load another example</button>
</div>
</div>

<div class="card" id="out" hidden></div>

<div class="card"><strong>Recent anonymous checks</strong> <small>(counts only; ingredient text is never stored)</small>
<div id="recent" class="mute">Loading...</div></div>

<div class="card"><strong>Ingredient database</strong> <small id="dbn"></small>
<div id="db" style="overflow-x:auto"></div></div>

<footer>Demo dataset for illustration, not legal or regulatory advice. Verify every decision against official EU and FDA sources.
Runs on Cloudflare Workers with a D1 (SQLite) database. Source on <a href="https://github.com/shahed1475/Inno-AI">GitHub</a>.</footer>
</main>
<script>
var $=function(id){return document.getElementById(id)};
var cls={approved:"ok",restricted:"warn",banned:"bad",unknown:"mute"};
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function pill(s){return '<span class="pill '+cls[s]+'">'+s+'</span>'}
var examples=[
"Wheat flour, sugar, titanium dioxide (E171), potassium bromate, tartrazine, citric acid, sodium benzoate, water",
"Carbonated water, sugar, brominated vegetable oil, allura red, aspartame, citric acid",
"Pork, salt, sodium nitrite, ascorbic acid, rosemary extract, dextrose",
"Sugar, glucose syrup, erythrosine, propylparaben, azodicarbonamide, monosodium glutamate"];
var ei=0;
$("ex").onclick=function(){ei=(ei+1)%examples.length;$("ing").value=examples[ei]};
$("go").onclick=function(){
  var b=$("go");b.disabled=true;b.textContent="Checking...";
  fetch("/api/check",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ingredients:$("ing").value,market:$("mkt").value})})
  .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})
  .then(function(x){
    var o=$("out");o.hidden=false;
    if(!x.ok){o.innerHTML='<span class="bad">'+esc(x.j.error)+'</span>';return}
    var j=x.j,vc=j.counts.banned?"bad":(j.counts.restricted||j.counts.unknown)?"warn":"ok";
    var h='<div class="verdict '+vc+'">'+esc(j.verdict)+'</div><div class="mute">'+j.counts.total+' items: '+j.counts.banned+' banned, '+j.counts.restricted+' restricted, '+j.counts.unknown+' not recognised ('+esc(j.market)+')</div>';
    h+='<table><tr><th>Item</th><th>Status</th><th>Details</th><th>Substitution ideas</th></tr>';
    j.results.forEach(function(r){
      if(!r.found){h+='<tr><td>'+esc(r.input)+'</td><td>'+pill("unknown")+'</td><td class="mute">Not in the demo database. Review manually.</td><td></td></tr>';return}
      h+='<tr><td>'+esc(r.name)+(r.eNumber?' <small>'+esc(r.eNumber)+'</small>':'')+'<br><small>'+esc(r.category)+'</small></td><td>'+pill(r.status)+'</td><td>'+esc(r.note)+'</td><td>'+(r.substitutes.length?esc(r.substitutes.join(", ")):'<span class="mute">None needed</span>')+'</td></tr>';
    });
    o.innerHTML=h+'</table>';
    loadRecent();
  }).catch(function(){$("out").hidden=false;$("out").innerHTML='<span class="bad">Request failed. Try again.</span>'})
  .then(function(){b.disabled=false;b.textContent="Check compliance"});
};
function loadRecent(){
  fetch("/api/recent").then(function(r){return r.json()}).then(function(rows){
    if(!rows.length){$("recent").textContent="No checks yet.";return}
    var h='<table><tr><th>When (UTC)</th><th>Market</th><th>Verdict</th><th>Items</th></tr>';
    rows.forEach(function(r){h+='<tr><td>'+esc(r.created_at)+'</td><td>'+esc(r.market)+'</td><td>'+esc(r.verdict)+'</td><td>'+r.total+' ('+r.banned+' banned, '+r.restricted+' restricted)</td></tr>'});
    $("recent").innerHTML=h+'</table>';
  }).catch(function(){$("recent").textContent="Could not load recent checks."});
}
function loadDb(){
  fetch("/api/ingredients").then(function(r){return r.json()}).then(function(rows){
    $("dbn").textContent="("+rows.length+" ingredients)";
    var h='<table><tr><th>Ingredient</th><th>Category</th><th>EU</th><th>US</th></tr>';
    rows.forEach(function(r){h+='<tr><td>'+esc(r.name)+(r.eNumber?' <small>'+esc(r.eNumber)+'</small>':'')+'</td><td>'+esc(r.category)+'</td><td>'+pill(r.EU.status)+'</td><td>'+pill(r.US.status)+'</td></tr>'});
    $("db").innerHTML=h+'</table>';
  }).catch(function(){$("db").textContent="Could not load the database."});
}
loadRecent();loadDb();
</script>
</body>
</html>`;
