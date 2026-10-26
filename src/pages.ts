// Public pages: the live scoreboard, per-domain pages and README badges.
// Styled as a tool on the Usual menu (tryusual.com): same paper, ink and
// orange, same header and footer. Self-contained HTML with no external
// scripts or fonts; the scoreboard polls /stats.

import { compact } from "./swarm.js";
import type { PublicPage } from "./store.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const USUAL = "https://tryusual.com";
const REPO = "https://github.com/pauljump/thought-swarm";

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
document.addEventListener('click',async e=>{const b=e.target.closest('[data-copy]');if(!b)return;
const t=document.getElementById(b.dataset.copy).textContent,n=document.getElementById('notice');
try{await navigator.clipboard.writeText(t);n.textContent='Copied. Paste it into your agent.'}catch(_){n.textContent='Select the text and copy it by hand.'}
n.classList.add('show');setTimeout(()=>n.classList.remove('show'),2200)});
</script>`;

function header(root: string): string {
  return `<div class="wrap"><header class="site-header"><a class="brand" href="${USUAL}/" aria-label="Usual home"><span class="brand-mark" aria-hidden="true">u</span>usual<span class="brand-period">.</span></a>
<nav aria-label="Main navigation"><a href="${USUAL}/#menu">Menu</a><a class="hide-sm" href="${esc(root)}/live">Scoreboard</a><a class="github-link" href="${REPO}">GitHub</a></nav></header></div>`;
}

function footer(): string {
  return `<footer class="site-footer wrap"><a class="brand" href="${USUAL}/">usual.</a><span>Make yourself at home.</span>
<div><a href="${USUAL}/privacy/">Privacy</a><a href="${USUAL}/catalog.json">Catalog</a><a href="${USUAL}/learn.md">Agent guide</a><a href="${REPO}">Open source · Apache-2.0</a></div></footer>
<div id="notice" class="toast" role="status" aria-live="polite"></div>`;
}

function shell(root: string, title: string, description: string, main: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f5f2e9"><title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<link rel="icon" href="${ICON}" type="image/svg+xml"><meta property="og:site_name" content="Usual"><meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(root)}/">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">
<style>${STYLE}</style></head><body>${header(root)}<main class="wrap">${main}</main>${footer()}${COPY_SCRIPT}${script}</body></html>`;
}

function copyBox(id: string, label: string, value: string): string {
  return `<div class="step"><label for="${id}">${label}</label><div class="copy"><code id="${id}">${value}</code><button type="button" data-copy="${id}">Copy</button></div></div>`;
}

const DESCRIPTION = "Thought Swarm, a tool on the Usual menu: your coding agent asks before it reads a docs page, and if another agent already read it, gets a short digest instead. Live tokens saved.";

export function liveHtml(base: string): string {
  const root = base.replace(/\/$/, "");
  const main = `
<div class="breadcrumbs"><a href="${USUAL}/#menu">The menu</a><span>/</span>Thought Swarm</div>
<section class="hero">
  <div>
    <p class="eyebrow">THE COLLECTION / ON THE HOUSE</p>
    <h1>Thought<br>Swarm<span class="orange">.</span></h1>
    <p class="lede">Your agent asks before it reads a docs page. If another agent already read it, it gets the short version.</p>
    <div class="actions"><a class="button primary" href="#install">Add your agent <span aria-hidden="true">→</span></a><a class="button" href="#reading">See what agents read</a></div>
    <p class="micro">Free and shared. One line to add, one line to remove. No account.</p>
  </div>
  <aside class="receipt" aria-labelledby="saved-label">
    <div class="receipt-top"><span><span class="status-dot live" aria-hidden="true"></span> THE SWARM / LIVE</span><span>ALL AGENTS · ALL TIME</span></div>
    <div class="big" id="saved">…</div>
    <p class="big-label" id="saved-label">tokens AI agents didn't have to read</p>
    <div class="tally">
      <div><span>reads served</span><b id="reads">…</b></div>
      <div><span>from cache</span><b id="rate">…</b></div>
      <div><span>agents</span><b id="agents">…</b></div>
      <div><span>pages read</span><b id="pages">…</b></div>
    </div>
    <div class="receipt-bottom">UPDATES EVERY 5 SECONDS · COUNTED FROM REAL READS</div>
  </aside>
</section>
<div class="layout"><div class="body">
<section id="install">
  <p class="eyebrow">01 / Make it yours</p><h2>One line, and your agent joins.</h2>
  <p>Every time a coding agent asks the swarm about a public docs page another agent already read, it gets a dense digest with the code examples kept word for word, plus a receipt of what it skipped.</p>
  ${copyBox("cmd-claude", "Claude Code, one command", `claude mcp add --transport http swarm ${esc(root)}/mcp`)}
  ${copyBox("cmd-paste", "Any agent with a shell, paste this into the chat", `Before you read any public docs page, ask the swarm first: curl -s '${esc(root)}/read?format=text&amp;url=&lt;page url&gt;'. Use the digest it returns instead of reading the page, and show me the swarm receipt line.`)}
</section>
<section id="reading">
  <p class="eyebrow">02 / Put it to work</p><h2>What agents are reading.</h2>
  <div class="board"><div class="board-label"><span>MOST READ · LAST 24 HOURS</span><span>READS · TOKENS SAVED</span></div><div id="top"><div class="empty">Loading…</div></div></div>
  <div class="board"><div class="board-label"><span><span class="status-dot live" aria-hidden="true" style="display:inline-block;margin-right:8px"></span>READING NOW</span><span>LATEST FIRST</span></div><div id="feed"><div class="empty">Loading…</div></div></div>
  <p class="micro" style="margin-top:18px">A page appears here only after three different agents have read it.</p>
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
    <dt>Works with</dt><dd>Claude Code (MCP), any agent with a shell, and A2A agents</dd>
    <dt>Reads</dt><dd>Public pages only. robots.txt is respected.</dd>
    <dt>Stores</dt><dd>The page URL and its digest. Nothing else your agent sends.</dd>
    <dt>Price</dt><dd>On the house</dd>
  </dl>
  <div class="source"><p class="eyebrow" style="margin:0">Source &amp; attribution</p><p><a href="${REPO}">pauljump/thought-swarm</a></p><p class="muted">Apache-2.0 · 0.1.0</p></div>
</aside></div>
<section class="next-tool"><p class="eyebrow">À la carte, always</p><h2>A little more your usual.</h2><a class="button" href="${USUAL}/#menu">Browse the menu <span aria-hidden="true">→</span></a></section>`;
  const script = `<script>
const fmt=n=>n>=1e9?(n/1e9).toFixed(1).replace(/\\.0$/,'')+'B':n>=1e6?(n/1e6).toFixed(1).replace(/\\.0$/,'')+'M':n.toLocaleString('en-US');
const ago=t=>{const s=Math.max(0,(Date.now()-t)/1e3);return s<60?'just now':s<3600?Math.round(s/60)+' min ago':Math.round(s/3600)+' h ago'};
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const row=(url,meta,cls,extra)=>'<div class="row'+(extra||'')+'"><a href="'+esc(url)+'" rel="noopener">'+esc(url.replace(/^https?:\\/\\//,''))+'</a><span class="dots" aria-hidden="true"></span><small class="'+cls+'">'+meta+'</small></div>';
let last=null;
async function tick(){try{const s=await (await fetch('${root}/stats',{cache:'no-store'})).json();const a=s.all_time;
document.getElementById('saved').textContent=fmt(a.tokens_saved);document.getElementById('reads').textContent=fmt(a.reads);
document.getElementById('agents').textContent=fmt(a.agents);document.getElementById('pages').textContent=fmt(a.pages);
document.getElementById('rate').textContent=Math.round(a.hit_rate*100)+'%';
document.getElementById('top').innerHTML=s.top_pages_24h.length?s.top_pages_24h.slice(0,12).map(p=>row(p.url,p.reads+' reads · '+fmt(p.tokens_saved)+' saved','')).join(''):'<div class="empty">No page has been read by three agents yet today.</div>';
const head=s.now_reading[0]?s.now_reading[0].at:null;
document.getElementById('feed').innerHTML=s.now_reading.length?s.now_reading.slice(0,12).map(r=>row(r.url,(r.hit?fmt(r.tokens_saved)+' saved':'first read')+' · '+ago(r.at),r.hit?'hit':'',last&&r.at>last?' flash':'')).join(''):'<div class="empty">Waiting for the first shared page.</div>';
last=head;}catch(e){}}
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
