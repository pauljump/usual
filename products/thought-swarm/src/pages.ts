// Public pages: the live scoreboard, per-domain pages and README badges.
// Styled as a tool on the Usual menu (tryusual.com): same paper, ink and
// orange, same header and footer. Self-contained HTML with no external
// scripts or fonts; the scoreboard polls /stats.

import { compact } from "./swarm.js";
import type { PublicPage, LibraryPage } from "./store.js";
import type { ShareInfo } from "./share.js";
import type { Digest } from "./digest.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const USUAL = "https://tryusual.com";
const REPO = "https://github.com/pauljump/usual/tree/main/products/thought-swarm";

// Usual's mark, inlined so the page makes no extra request.
const ICON = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="#1e2c3d"/><path d="M13 12v16a11 11 0 0 0 22 0V12" fill="none" stroke="#fff9ef" stroke-width="4"/></svg>`)}`;

// Tokens and components follow tryusual.com's collection.css.
const STYLE = `
:root{--paper:#f5f2e9;--ink:#262820;--muted:#64675b;--orange:#cc482b;--green:#385744;--line:#d5d3c5;--light:#fffdf7;--soft:#eae8dc;
--mono:ui-monospace,SFMono-Regular,Consolas,monospace;--sans:"Helvetica Neue",Helvetica,Arial,sans-serif}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit;text-underline-offset:4px}button{font:inherit;cursor:pointer}
a:focus-visible,button:focus-visible{outline:3px solid var(--orange);outline-offset:5px}::selection{background:#f4c8a9}
p{margin:0 0 18px}h1,h2,h3{font-weight:600;line-height:1.03;letter-spacing:-.055em;margin:0}
h2{font-size:clamp(32px,4.2vw,48px)}h3{font-size:24px;letter-spacing:-.04em}
.wrap{width:min(1180px,calc(100% - 80px));margin-inline:auto}
.orange{color:var(--orange)}.muted,.micro{color:var(--muted)}.micro{font-size:12px;line-height:1.6}
.eyebrow,.receipt-top,.receipt-bottom,.board-label,.board-footer,.row small,.chip{font-family:var(--mono);font-size:11px;letter-spacing:.07em;text-transform:uppercase}
.eyebrow{font-weight:500;display:flex;align-items:center;gap:9px;margin-bottom:18px}
.status-dot{display:inline-block;width:7px;height:7px;background:var(--green);border-radius:50%;flex:none}
@media (prefers-reduced-motion:no-preference){.status-dot.live{animation:pulse 2s ease-in-out infinite}@keyframes pulse{50%{opacity:.35}}}
.site-header{height:112px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);gap:20px}
.brand{font-size:37px;font-weight:650;letter-spacing:-.07em;text-decoration:none;line-height:1;display:inline-flex;gap:10px;align-items:center}
.brand-mark{font-size:31px;border-radius:9px;background:var(--orange);font-weight:400;color:var(--light);width:37px;height:37px;display:inline-flex;align-items:center;justify-content:center;line-height:1;padding-bottom:5px}
.brand-period{margin-left:-11px;color:var(--orange)}
.site-header nav{display:flex;align-items:center;gap:34px;font-size:13px;font-weight:550}.site-header nav a{text-decoration:none}
.github-link{padding:10px 17px;border:1px solid var(--ink);border-radius:4px}.github-link:hover{background:var(--ink);color:var(--paper)}
.breadcrumbs{display:flex;gap:10px;color:var(--muted);font-size:11px;margin:28px 0 56px;flex-wrap:wrap}.breadcrumbs a{text-decoration:none}.breadcrumbs a:hover{color:var(--ink)}
.hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:70px;align-items:start}
.hero h1{font-size:clamp(56px,8vw,112px);letter-spacing:-.072em;line-height:.97;font-weight:550;margin:0 0 30px}
.lede{font-size:20px;line-height:1.5;letter-spacing:-.025em;max-width:30ch}
.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:15px}
.button{display:inline-flex;gap:24px;justify-content:space-between;align-items:center;text-decoration:none;font-size:13px;font-weight:550;line-height:1.4;padding:15px 21px;border-radius:3px;border:1px solid var(--ink);min-height:49px;transition:background .15s,transform .15s;background:transparent;color:var(--ink)}
.button:hover{transform:translateY(-2px);background:var(--soft)}.button.primary{background:var(--ink);color:var(--light)}.button.primary:hover{background:var(--green)}
.receipt{background:var(--light);border:1px solid var(--ink);border-radius:4px;padding:24px 28px 26px;box-shadow:0 5px 0 #e7e4d8}
.receipt-top{display:flex;justify-content:space-between;gap:15px;font-size:9px;border-bottom:1px dashed var(--line);padding-bottom:15px;margin-bottom:20px;color:var(--muted)}
.receipt-bottom{font-size:9px;color:var(--muted);padding-top:15px;border-top:1px dashed var(--line);margin-top:20px}
.big{font-size:clamp(56px,8vw,96px);font-weight:550;letter-spacing:-.06em;line-height:1;color:var(--orange);font-variant-numeric:tabular-nums}
.big-label{font-size:14px;color:var(--muted);margin:10px 0 0}
.tally{display:grid;grid-template-columns:1fr 1fr;margin-top:22px;border-top:1px solid var(--line)}
.tally div{padding:13px 0;border-bottom:1px solid #e6e4d9;display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:13px;color:var(--muted)}
.tally div:nth-child(odd){padding-right:16px;border-right:1px solid #e6e4d9}.tally div:nth-child(even){padding-left:16px}
.tally b{font-size:22px;font-weight:550;letter-spacing:-.04em;color:var(--ink);font-variant-numeric:tabular-nums}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:70px;margin-top:110px;align-items:start}
.body{display:grid;gap:90px;min-width:0}.body section h2{margin-bottom:22px}.body section>p{max-width:62ch}
.step{display:grid;gap:8px;margin:22px 0}.step label{font-size:13px;font-weight:600}
.copy{display:flex;align-items:stretch;border:1px solid #c2c4b6;border-radius:3px;background:var(--light);overflow:hidden}
.copy code{flex:1;min-width:0;font:12.5px/1.65 var(--mono);padding:14px 16px;overflow-wrap:anywhere}
.copy button{border:0;border-left:1px solid #c2c4b6;background:var(--soft);font-size:12px;font-weight:550;padding:0 16px;color:var(--ink);white-space:nowrap}.copy button:hover{background:var(--ink);color:var(--light)}
.board{border:1px solid var(--ink);border-radius:4px;background:var(--light);padding:0 26px;box-shadow:0 5px 0 #e7e4d8}
.board+.board{margin-top:30px}
.board-label,.board-footer{display:flex;justify-content:space-between;gap:16px;font-size:9px;color:var(--muted);padding:18px 0}
.board-label{border-bottom:1px solid var(--line)}
.row{display:flex;gap:14px;align-items:baseline;padding:13px 0;border-bottom:1px solid var(--line);text-decoration:none;min-width:0}
.row:last-child{border-bottom:0}
.row a{text-decoration:none;font-size:15px;letter-spacing:-.01em;overflow-wrap:anywhere;min-width:0}.row a:hover{color:var(--orange)}
.document-label{min-width:0}.document-url{display:block;font-size:12px;color:var(--muted);overflow-wrap:anywhere;margin-top:4px}
.row .dots{flex:1;border-bottom:2px dotted #cbccbd;min-width:16px;transform:translateY(-4px)}
.row small{font-size:10px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}.row small.hit{color:var(--green)}
.empty{padding:20px 0;color:var(--muted);font-size:14px}
.facts{border-left:1px solid var(--line);padding:0 0 0 28px;position:sticky;top:30px}
.facts h3{margin-bottom:20px}
dl{display:grid;grid-template-columns:105px minmax(0,1fr);gap:16px;margin:0 0 28px;font-size:13px}
dt{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding-top:2px}dd{margin:0}
.source{border-top:1px solid var(--line);padding-top:22px;font-size:13px}.source p{margin:6px 0 0}
.inline{font:12px var(--mono);background:var(--soft);border:1px solid var(--line);border-radius:3px;padding:2px 6px;white-space:nowrap}
.next-tool{padding:60px 0;border-top:1px solid var(--line);margin-top:110px}.next-tool h2{font-size:40px;margin-bottom:25px}
.site-footer{display:flex;justify-content:space-between;align-items:center;gap:25px;padding:50px 0 38px;border-top:1px solid var(--line)}
.site-footer>.brand{font-size:30px}.site-footer>span{font-size:11px;color:var(--muted);margin-right:auto}
.site-footer>div{display:flex;gap:20px;font-size:10px;color:var(--muted);flex-wrap:wrap}.site-footer>div a{text-decoration:none}.site-footer>div a:hover{color:var(--ink)}
.share-actions{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.share-actions a,.share-actions button,.share-submit{border:1px solid var(--ink);padding:10px 16px;border-radius:3px;background:var(--light);color:var(--ink);font-size:14px;text-decoration:none}.share-actions a:hover,.share-actions button:hover{background:var(--soft)}.share-submit{background:var(--orange);color:var(--light);border-color:var(--orange)}.share-panel{padding:22px;background:var(--light);border:1px solid var(--line);border-radius:4px;margin:26px 0}.share-panel summary{cursor:pointer}.share-panel img,.share-preview{display:block;width:100%;height:auto;border:1px solid var(--line);margin:16px 0}.share-form label{display:block;margin:0 0 8px}.share-form input{width:100%;padding:14px;font:inherit;border:1px solid var(--muted);border-radius:3px;margin-bottom:12px}.share-form input:focus-visible{outline:3px solid var(--orange);outline-offset:3px}.share-link{overflow-wrap:anywhere;font-family:var(--mono);font-size:13px}.share-error{color:#9d2618;margin:12px 0}
.library-search{margin:24px 0}.library-search>label{display:block;margin-bottom:8px}.search-line{display:flex;gap:10px}.search-line input{flex:1;min-width:0;font:inherit;padding:14px 16px;border:1px solid var(--muted);border-radius:3px;background:var(--light);color:var(--ink)}.library-filters{display:flex;gap:18px;align-items:end;flex-wrap:wrap;margin-top:18px}.library-filters label{display:grid;gap:6px;font-size:13px}.library-filters select{font:inherit;padding:10px;background:var(--light);border:1px solid var(--line);max-width:100%}.library-results{margin:38px 0 70px}.document-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.document-card{border:1px solid var(--line);border-radius:4px;padding:24px;display:flex;flex-direction:column;background:var(--light);min-width:0}.document-card h2{font-size:23px;line-height:1.2;letter-spacing:-.025em;margin:0 0 18px;overflow-wrap:anywhere}.document-card h2 a{text-decoration:none}.document-card .eyebrow{overflow-wrap:anywhere;margin-bottom:16px}.document-action{margin-top:auto;padding-top:18px;font-size:14px}.library-pagination{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:30px}.library-pagination>span{font-size:13px}@media(max-width:1000px){.document-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.document-grid{grid-template-columns:1fr}.search-line{flex-direction:column}.library-filters{align-items:stretch;flex-direction:column}}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);opacity:0;background:var(--ink);color:var(--light);font-size:12px;padding:11px 16px;border-radius:3px;transition:.2s;pointer-events:none}.toast.show{opacity:1;transform:translate(-50%,0)}
@media (prefers-reduced-motion:no-preference){.flash{animation:f 1.4s ease-out}@keyframes f{from{background:#f3eedf}to{background:transparent}}}
@media (max-width:1050px){.wrap{width:calc(100% - 56px)}.hero,.layout{grid-template-columns:1fr;gap:50px}.facts{position:static;border-left:0;border-top:1px solid var(--line);padding:28px 0 0}}
@media (max-width:760px){.wrap{width:calc(100% - 32px)}.site-header{height:84px}.brand{font-size:30px}.brand-mark{width:31px;height:31px;font-size:26px}.brand-period{margin-left:-9px}
.site-header nav{gap:16px;font-size:12px}.github-link{padding:8px 12px}.breadcrumbs{margin:22px 0 36px;font-size:10px}.layout{margin-top:70px}.body{gap:64px}
.board{padding:0 16px}.row{flex-wrap:wrap;gap:4px 14px}.row .dots{display:none}.row small{flex-basis:100%}
.copy{flex-direction:column}.copy button{border-left:0;border-top:1px solid #c2c4b6;padding:11px 16px;text-align:left}
dl{grid-template-columns:95px minmax(0,1fr)}.site-footer{flex-wrap:wrap;padding:35px 0 30px}.site-footer>div{flex-basis:100%;gap:18px}}
@media (max-width:420px){.site-header nav .hide-sm{display:none}.tally{grid-template-columns:1fr}.tally div:nth-child(odd){padding-right:0;border-right:0}.tally div:nth-child(even){padding-left:0}}
`;

const COPY_SCRIPT = `<script>
fetch('/github-stars').then(r=>r.ok?r.json():null).then(data=>{
if(!data||!Number.isSafeInteger(data.stars)||data.stars<0)return;
for(const el of document.querySelectorAll('[data-github-stars]')){
el.textContent=' · ★ '+data.stars.toLocaleString();
el.parentElement.setAttribute('aria-label','Usual on GitHub, '+data.stars.toLocaleString()+' stars');
}}).catch(()=>{});

document.addEventListener('click',async e=>{const b=e.target.closest('[data-copy]');if(!b)return;
const t=document.getElementById(b.dataset.copy).textContent,n=document.getElementById('notice');
try{await navigator.clipboard.writeText(t);n.textContent='Copied.'}catch(_){n.textContent='Select the text and copy it by hand.'}
n.classList.add('show');setTimeout(()=>n.classList.remove('show'),2200)});
</script>`;

function header(root: string): string {
  return `<div class="wrap"><header class="site-header"><a class="brand" href="${USUAL}/" aria-label="Usual home"><span class="brand-mark" aria-hidden="true">u</span>usual<span class="brand-period">.</span></a>
<nav aria-label="Main navigation"><a href="${USUAL}/#menu">Menu</a><a class="hide-sm" href="${esc(root)}/library">Library</a><a href="${esc(root)}/share">Share</a><a class="github-link" href="https://github.com/pauljump/usual" aria-label="Usual on GitHub">GitHub<span data-github-stars></span></a></nav></header></div>`;
}

function footer(): string {
  return `<footer class="site-footer wrap"><a class="brand" href="${USUAL}/">usual.</a><span>Make yourself at home.</span>
<div><a href="${USUAL}/privacy/">Privacy</a><a href="${USUAL}/catalog.json">Catalog</a><a href="${USUAL}/learn.md">Agent guide</a><a href="${REPO}">Open source · Apache-2.0</a></div></footer>
<div id="notice" class="toast" role="status" aria-live="polite"></div>`;
}

function shell(root: string, title: string, description: string, main: string, script = "", social?: ShareInfo): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f5f2e9"><title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<link rel="alternate" type="text/plain" title="Agent guide" href="${esc(root)}/llms.txt"><link rel="icon" href="${ICON}" type="image/svg+xml"><meta property="og:site_name" content="Thought Swarm"><meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(social?.url ?? root + '/')}">
${social ? `<link rel="canonical" href="${esc(social.url)}"><meta property="og:image" content="${esc(social.image_url)}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(social.image_alt)}"><meta name="twitter:image" content="${esc(social.image_url)}"><meta name="twitter:image:alt" content="${esc(social.image_alt)}">` : ''}
<meta name="twitter:card" content="${social ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">
<style>${STYLE}</style></head><body>${header(root)}<main class="wrap">${main}</main>${footer()}${COPY_SCRIPT}${script}</body></html>`;
}

function copyBox(id: string, label: string, value: string): string {
  return `<div class="step"><label for="${id}">${label}</label><div class="copy"><code id="${id}">${value}</code><button type="button" data-copy="${id}">Copy</button></div></div>`;
}

const DESCRIPTION = "Thought Swarm is a shared library of AI-generated document summaries. People can find and share digests; AI agents can reuse them instead of processing the full source.";

export function liveHtml(base: string): string {
  const root = base.replace(/\/$/, "");
  const main = `
<div class="breadcrumbs"><a href="${USUAL}/#menu">The menu</a><span>/</span>Thought Swarm</div>
<section class="hero">
  <div>
    <p class="eyebrow">THOUGHT SWARM</p>
    <h1 style="font-size:clamp(44px,6vw,76px)">Shared reading<br>for AI agents<span class="orange">.</span></h1>
    <p class="lede">A shared library of AI-generated summaries of public documents. Read and share a digest yourself, or let your agent reuse it instead of processing the full document.</p>
    <div class="actions"><a class="button primary" href="/library">Find a document →</a><a class="button" href="#install">Connect your agent →</a></div>
    <p class="micro">Free and shared. One line to add, one line to remove. No account.</p>
  </div>
  <aside class="receipt" aria-labelledby="saved-label">
    <div class="receipt-top"><span><span class="status-dot live" aria-hidden="true"></span> THE SWARM / LIVE</span><span>ALL AGENTS · ALL TIME</span></div>
    <div class="big" id="saved">…</div>
    <p class="big-label" id="saved-label">estimated tokens avoided by reusing digests</p>
    <div class="tally">
      <div><span>document requests</span><b id="reads">…</b></div>
      <div><span>reused digests</span><b id="rate">…</b></div>
      <div><span>agent identifiers</span><b id="agents">…</b></div>
      <div><span>pages read</span><b id="pages">…</b></div>
    </div>
    <div class="receipt-bottom">UPDATES EVERY 5 SECONDS · RECORDED API REQUESTS</div>
  </aside>
</section>
<div class="layout"><div class="body">
<section id="library">
  <p class="eyebrow">The shared library</p><h2>Find something already read.</h2>
  <p>Search the documents in Thought Swarm. Give your agent a saved digest, or share one with someone else.</p>
  <form action="/library" method="get" class="library-search" role="search"><label class="micro" for="home-search">Search by document, topic, or website</label><div class="search-line"><input id="home-search" name="q" type="search" placeholder="What are you looking for?" maxlength="160"><button class="button primary" type="submit">Search library →</button></div></form>
  <p style="margin-top:18px"><a href="/library">Browse all documents →</a></p>
</section>
<section id="install">
  <p class="eyebrow">For AI agents</p><h2>Find a document. Reuse its digest.</h2>
  <p>Connect through MCP to search the library and read a saved digest. If a public page has not been saved, requesting it can create a new digest. Each result identifies its source and capture date; summaries can omit details, so consult the original when exact wording matters.</p>
  ${copyBox("cmd-claude", "Claude Code, one command", `claude mcp add --transport http swarm ${esc(root)}/mcp`)}
  ${copyBox("cmd-paste", "Any agent with a shell, paste this into the chat", `Before you read any public docs page, ask the swarm first: curl -s '${esc(root)}/read?format=text&amp;url=&lt;page url&gt;'. Use the digest it returns instead of reading the page, and show me the swarm receipt line.`)}
<p class="micro"><a href="/llms.txt">Agent guide: tools, endpoints, and how to interpret results →</a></p>
</section>
<section id="reading">
  <p class="eyebrow">02 / Shared reading activity</p><h2>Documents requested through the swarm.</h2>
  <p>One row per document, showing how often it was requested in the last 24 hours and the estimated text avoided by reusing its digest. This is usage activity; the searchable library above shows what is available.</p>
  <p><strong>Tokens saved</strong> estimates how much less text an agent received by using the digest. Tokens are the small pieces of text AI models process; these counts are estimates, not measured cost savings.</p>
  <div class="board"><div class="board-label"><span>MOST REQUESTED DOCUMENTS · LAST 24 HOURS</span><span>REQUESTS · EST. TOKENS SAVED</span></div><div id="top"><div class="empty">Loading…</div></div></div>
  <p class="micro" style="margin-top:18px">For privacy, documents appear here only after requests from three distinct agent identifiers. Counts can include testing and repeat requests; they are not a count of unique people. Preloading does not count as a read.</p>
</section>
<section id="adjust">
  <p class="eyebrow">03 / Keep it your way</p><h2>Inspect, opt out, remove.</h2>
  ${copyBox("cmd-remove", "Remove it from Claude Code", "claude mcp remove swarm")}
  <p>Run a docs site and would rather agents read it directly? Add <span class="inline">User-agent: ThoughtSwarm</span> with <span class="inline">Disallow: /</span> to your robots.txt and the swarm stops within the hour.</p>
</section>
</div>
<aside class="facts" aria-label="The particulars">
  <p class="eyebrow">The particulars</p><h3>At a glance.</h3>
  <dl>
    <dt>Status</dt><dd>Public beta</dd>
    <dt>Works with</dt><dd>Claude Code (MCP) and any agent with a shell</dd>
    <dt>Reads</dt><dd>Public pages only. robots.txt is respected.</dd>
    <dt>Stores</dt><dd>Public source snapshots and their digests. Nothing else your agent sends.</dd>
    <dt>Price</dt><dd>On the house</dd>
  </dl>
  <div class="source"><p class="eyebrow" style="margin:0">Source &amp; attribution</p><p><a href="${REPO}">Usual / Thought Swarm</a></p><p class="muted">Apache-2.0 · 0.1.0</p></div>
</aside></div>
<section class="next-tool"><p class="eyebrow">À la carte, always</p><h2>A little more your usual.</h2><a class="button" href="${USUAL}/#menu">Browse the menu <span aria-hidden="true">→</span></a></section>`;
  const script = `<script>
const fmt=n=>n>=1e9?(n/1e9).toFixed(1).replace(/\\.0$/,'')+'B':n>=1e6?(n/1e6).toFixed(1).replace(/\\.0$/,'')+'M':n.toLocaleString('en-US');
const ago=t=>{const s=Math.max(0,(Date.now()-t)/1e3);return s<60?'just now':s<3600?Math.round(s/60)+' min ago':Math.round(s/3600)+' h ago'};
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const row=(url,title,meta,cls,extra)=>'<div class="row'+(extra||'')+'"><div class="document-label"><a href="/document?url='+encodeURIComponent(url)+'">'+esc(title||'Untitled document')+'</a><span class="document-url">'+esc(url.replace(/^https?:\\/\\//,''))+'</span></div><span class="dots" aria-hidden="true"></span><small class="'+cls+'">'+meta+'</small></div>';
async function tick(){try{const s=await (await fetch('${root}/stats',{cache:'no-store'})).json();const a=s.all_time;
document.getElementById('saved').textContent=fmt(a.tokens_saved);document.getElementById('reads').textContent=fmt(a.reads);
document.getElementById('agents').textContent=fmt(a.agents);document.getElementById('pages').textContent=fmt(a.pages);
document.getElementById('rate').textContent=Math.round(a.hit_rate*100)+'%';
document.getElementById('top').innerHTML=s.top_pages_24h.length?s.top_pages_24h.slice(0,12).map(p=>row(p.url,p.title,p.reads+' requests · ~'+fmt(p.tokens_saved)+' tokens saved','')).join(''):'<div class="empty">No page has been read by three agents yet today.</div>';
}catch(e){}}
tick();setInterval(tick,5000);
</script>`;
  return shell(root, "Thought Swarm · Usual", DESCRIPTION, main, script);
}

export function domainHtml(base: string, domain: string, t: { reads: number; agents: number; tokens_saved: number }, pages: PublicPage[]): string {
  const root = base.replace(/\/$/, "");
  const badge = `[![Read by AI agents via Thought Swarm](${root}/badge/${domain}.svg)](${root}/p/${domain})`;
  const main = `
<div class="breadcrumbs"><a href="${USUAL}/#menu">The menu</a><span>/</span><a href="${esc(root)}/">Thought Swarm</a><span>/</span>${esc(domain)}</div>
<section class="hero">
  <div>
    <p class="eyebrow">THOUGHT SWARM / BY SITE</p>
    <h1 style="font-size:clamp(44px,6vw,80px)">How AI agents read ${esc(domain)}<span class="orange">.</span></h1>
  </div>
  <aside class="receipt">
    <div class="receipt-top"><span>${esc(domain.toUpperCase())}</span><span>ALL TIME</span></div>
    <div class="big">${compact(t.tokens_saved)}</div>
    <p class="big-label">tokens saved on this site's docs</p>
    <div class="tally"><div><span>reads</span><b>${compact(t.reads)}</b></div><div><span>agents</span><b>${compact(t.agents)}</b></div></div>
  </aside>
</section>
<div class="layout" style="grid-template-columns:minmax(0,1fr)"><div class="body">
<section>
  <p class="eyebrow">01 / Most read</p><h2>The pages agents keep coming back to.</h2>
  <div class="board"><div class="board-label"><span>${esc(domain.toUpperCase())}</span><span>READS · AGENTS</span></div>${
    pages.length
      ? pages.map((p) => `<div class="row"><a href="${esc(p.url)}" rel="noopener">${esc(p.url.replace(/^https?:\/\//, ""))}</a><span class="dots" aria-hidden="true"></span><small>${p.reads} reads · ${p.agents} agents</small></div>`).join("")
      : `<div class="empty">No page on this site has been read by three different agents yet.</div>`
  }</div>
</section>
<section>
  <p class="eyebrow">02 / For maintainers</p><h2>Show it off, or opt out.</h2>
  ${copyBox("badge", "Add the badge to your README", esc(badge))}
  <p>Don't want agents reading your docs through the swarm? Add <span class="inline">User-agent: ThoughtSwarm</span> with <span class="inline">Disallow: /</span> to your robots.txt and the swarm stops within the hour.</p>
</section>
</div></div>
<section class="next-tool"><p class="eyebrow">À la carte, always</p><h2>A little more your usual.</h2><a class="button" href="${USUAL}/#menu">Browse the menu <span aria-hidden="true">→</span></a></section>`;
  return shell(root, `${domain} on Thought Swarm · Usual`, `How often AI coding agents read ${domain} through Thought Swarm, a tool on the Usual menu.`, main);
}

// Usual's ink and green, with the orange u mark.
export function badgeSvg(reads: number): string {
  const label = "read by agents";
  const value = compact(reads);
  const lw = 104;
  const vw = Math.max(34, 8 + value.length * 7.2);
  const w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">
<title>${label}: ${value}</title><clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#262820"/><rect x="${lw}" width="${vw}" height="20" fill="#385744"/></g>
<rect x="5" y="4" width="12" height="12" rx="3" fill="#cc482b"/><path d="M8.5 7v3.2a2.5 2.5 0 0 0 5 0V7" fill="none" stroke="#fffdf7" stroke-width="1.4"/>
<g fill="#fffdf7" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${(lw + 20) / 2}" y="14">${label}</text><text x="${lw + vw / 2}" y="14">${value}</text></g></svg>`;
}

export function libraryHtml(base: string, data: LibraryPage): string {
  const {entries,total,page,page_size,q,source,status,sources,ready}=data;
  const pages=Math.max(1,Math.ceil(total/page_size));
  const pageLink=(n:number)=>'/library?'+new URLSearchParams({q,source,status,page:String(n)}).toString();
  const range=total ? `${(page-1)*page_size+1}–${Math.min(page*page_size,total)} of ${total.toLocaleString('en-US')}` : 'No matching documents';
  const navigation=pages>1 ? `<nav class="library-pagination" aria-label="Library pages">${page>1?`<a class="button" rel="prev" href="${esc(pageLink(page-1))}">← Previous</a>`:'<span></span>'}<span>Page ${page} of ${pages}</span>${page<pages?`<a class="button" rel="next" href="${esc(pageLink(page+1))}">Next →</a>`:'<span></span>'}</nav>`:'';
  const fallback=(url:string)=>{const path=new URL(url).pathname.split('/').filter(Boolean).pop();return path?path.replace(/[-_]/g,' ').replace(/\.(html?|json)$/,''):'Document';};
  return shell(base, "Library · Thought Swarm", "Search saved documents by title, topic, or source. Read and share their digests.", `
    <div class="breadcrumbs"><a href="/live">Thought Swarm</a><span>/</span>Library</div>
    <h1 style="font-size:clamp(40px,6vw,64px)">Already read. Ready for you.</h1>
    <p class="lede" style="max-width:60ch;margin:22px 0">${ready.toLocaleString('en-US')} saved documents. Find a digest for your agent, or a link to share.</p>
    <form action="/library" method="get" class="library-search" role="search"><label for="library-query">Search by document, topic, or website</label>
    <div class="search-line"><input id="library-query" name="q" type="search" value="${esc(q)}" placeholder="What are you looking for?" maxlength="160"><button type="submit" class="button primary">Search</button></div>
    <div class="library-filters"><label>Source <select name="source"><option value="">All sources</option>${sources.map(s=>`<option value="${esc(s.source)}" ${source===s.source?'selected':''}>${esc(s.source)} (${s.count})</option>`).join('')}</select></label>
    <label>Availability <select name="status"><option value="ready" ${status==='ready'?'selected':''}>Ready to read</option><option value="all" ${status==='all'?'selected':''}>All documents</option><option value="unavailable" ${status==='unavailable'?'selected':''}>Unavailable</option></select></label><button type="submit" class="button">Apply filters</button>${q||source||status!=='ready'?'<a href="/library">Clear filters</a>':''}</div></form>
    <div class="library-results"><p class="micro">${range}</p>
    ${entries.length?`<div class="document-grid">${entries.map(e=>`<article class="document-card"><p class="eyebrow">${esc(e.source)}</p><h2><a href="${e.status==='ready'?'/document?url='+encodeURIComponent(e.url):esc(e.url)}">${esc(e.title||fallback(e.url))}</a></h2><p class="micro">${esc(e.collection)}</p>${e.status==='ready'?'<p class="micro">Saved digest · Ready to read</p>':`<p class="micro">Unavailable · ${esc(e.detail)}</p>`}<a class="document-action" href="${e.status==='ready'?'/document?url='+encodeURIComponent(e.url):esc(e.url)}">${e.status==='ready'?'Read & share →':'Visit source ↗'}</a></article>`).join('')}</div>`:'<div class="board"><p class="empty">No documents match these filters. Try a shorter search or choose all sources.</p><p><a href="/library">Browse all ready documents →</a></p></div>'}
    ${navigation}</div>`);
}

export function documentHtml(base: string, d: Digest, url: string, at: number, receipt: string, social?: ShareInfo): string {
  return shell(base, `${d.title} · Thought Swarm`, d.summary.slice(0, 180), `
    <div class="breadcrumbs"><a href="/live">Thought Swarm</a><span>/</span><a href="/library">Library</a></div>
    <article style="max-width:850px;margin:0 auto 70px"><h1 style="font-size:clamp(32px,5vw,58px)">${esc(d.title)}</h1>
    <p class="micro" style="margin-top:20px">Source snapshot ${new Date(at).toISOString()} · Saved digest; source not re-fetched.</p>
    <p><a href="${esc(url)}">Original source ↗</a> · <a href="${social ? esc(social.url) + '?format=text' : '/read?format=text&amp;url=' + encodeURIComponent(url)}">Agent-readable version</a></p>
    ${social ? shareControls(social) : ''}
    <p style="font-size:20px">${esc(d.summary)}</p>
    ${d.version_info ? `<p class="micro">${esc(d.version_info)}</p>` : ''}
    <h2>Key points</h2><ul>${d.key_points.map(p => `<li style="margin:16px 0">${esc(p)}</li>`).join('')}</ul>
    ${d.api.length ? '<h2>API</h2>' + d.api.map(a => `<p><code>${esc(a.signature || a.name)}</code> ${esc(a.notes)}</p>`).join('') : ''}
    ${d.code_examples.map(e => `<h3>${esc(e.caption)}</h3><pre style="overflow:auto;padding:20px;background:var(--light)"><code>${esc(e.code)}</code></pre>`).join('')}
    ${d.gotchas.length ? '<h2>Qualifications</h2><ul>' + d.gotchas.map(g => `<li style="margin:12px 0">${esc(g)}</li>`).join('') + '</ul>' : ''}
    <pre style="white-space:pre-wrap;overflow-wrap:anywhere" class="receipt">${esc(receipt)}</pre></article>`, "", social);
}

function shareControls(info: ShareInfo): string {
  const intent = 'https://x.com/intent/post?text=' + encodeURIComponent('Read once. Share the digest. ' + info.title.slice(0,130)) + '&url=' + encodeURIComponent(info.url);
  return `<section class="share-panel" aria-label="Share this digest">
    <p><strong>Read once. Pass it on.</strong></p><p id="document-share-link" class="share-link">${esc(info.url)}</p>
    <div class="share-actions"><button type="button" data-copy="document-share-link">Copy share link</button><a href="${esc(intent)}" target="_blank" rel="noopener noreferrer">Share on X ↗</a><a href="${esc(info.image_url)}" download="thought-swarm.png">Download image</a></div>
    <details><summary>Preview the social image</summary><img src="${esc(info.image_url)}" alt="${esc(info.image_alt)}" width="1200" height="630" loading="lazy"><p class="micro">A link to this saved version, with a preview image for social feeds.</p></details></section>`;
}

export function shareHtml(base: string): string {
  return shell(base, 'Share a digest · Thought Swarm', 'Turn a saved digest into a short link with a social preview image.', `
    <div class="breadcrumbs"><a href="/live">Thought Swarm</a><span>/</span>Share</div>
    <article style="max-width:850px;margin:0 auto 70px"><p class="eyebrow">Already read. Ready to share.</p><h1 style="font-size:clamp(40px,6vw,72px)">One link.<br>One less reread.</h1>
    <p class="lede" style="margin:24px 0">Give someone a head start. Make a short link to any saved digest, with an image ready for their feed.</p>
    <form id="share-form" class="share-form"><label for="source-url">Document URL</label><input id="source-url" name="url" type="url" required placeholder="Paste the original URL or a Thought Swarm link" autocomplete="off"><button class="share-submit" id="make-share" type="submit">Make share link</button></form>
    <p class="micro" style="margin-top:12px">Choose a saved document from the <a href="/library">library</a>. The link keeps this version of its digest.</p><p id="share-status" role="status" aria-live="polite"></p>
    <section id="share-result" hidden><img id="share-image" class="share-preview" width="1200" height="630" alt=""><h2 id="share-title" style="font-size:28px"></h2><p id="generated-link" class="share-link" style="margin-top:16px"></p><div class="share-actions"><button type="button" data-copy="generated-link">Copy share link</button><a id="share-open">Open digest</a><a id="share-x" target="_blank" rel="noopener noreferrer">Share on X ↗</a><a id="share-download" download="thought-swarm.png">Download image</a></div></section></article>`, `<script>
const form=document.getElementById('share-form'),status=document.getElementById('share-status'),button=document.getElementById('make-share'),result=document.getElementById('share-result');
form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;status.className='';status.textContent='Making your link…';result.hidden=true;
try{const response=await fetch('/share',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:document.getElementById('source-url').value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not make a link. Try again.');
document.getElementById('share-title').textContent=data.title;document.getElementById('generated-link').textContent=data.url;document.getElementById('share-open').href=data.url;document.getElementById('share-download').href=data.image_url;const image=document.getElementById('share-image');image.src=data.image_url;image.alt=data.image_alt;
document.getElementById('share-x').href='https://x.com/intent/post?text='+encodeURIComponent('Read once. Share the digest. '+data.title.slice(0,130))+'&url='+encodeURIComponent(data.url);status.textContent='Ready to share. The preview image travels with your link.';result.hidden=false;
}catch(error){status.className='share-error';status.textContent=error.message||'Could not make a link. Try again.';}finally{button.disabled=false;}});
</script>`);
}
