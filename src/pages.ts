// Public pages: the live scoreboard, per-domain pages and README badges.
// Self-contained HTML with no external scripts; the scoreboard polls /stats.

import { compact } from "./swarm.js";
import type { PublicPage } from "./store.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STYLE = `
:root{--bg:#f5f6f3;--surface:#fff;--fg:#141c19;--muted:#5d6a65;--line:#d8dfdb;--accent:#0e6b5c;--honey:#a86d12;--soft:#e3f0ec;
--display:"Bricolage Grotesque","Avenir Next",system-ui,sans-serif;--body:"IBM Plex Sans","Helvetica Neue",Arial,sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0e1412;--surface:#151d1a;--fg:#e3eae7;--muted:#98a8a2;--line:#283430;--accent:#5cc4ae;--honey:#e3a948;--soft:#17302a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 var(--body)}
.wrap{max-width:1040px;margin:0 auto;padding:40px max(16px,env(safe-area-inset-left)) 80px max(16px,env(safe-area-inset-right));display:grid;gap:40px}
h1,h2{font-family:var(--display);margin:0;line-height:1.1;text-wrap:balance}h1{font-size:clamp(2rem,5vw,3.2rem)}h2{font-size:1.3rem}
.eyebrow{font:500 .75rem/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.big{font:700 clamp(3rem,10vw,6.5rem)/1 var(--display);color:var(--honey);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;display:grid;gap:4px}
.tile b{font:700 1.8rem/1 var(--display);font-variant-numeric:tabular-nums}.tile span{color:var(--muted);font-size:.9rem}
.cols{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:24px}@media (max-width:760px){.cols{grid-template-columns:1fr}}
.list{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:10px 14px;border-top:1px solid var(--line);align-items:baseline}
.row:first-child{border-top:0}.row a{color:var(--fg);text-decoration:none;overflow-wrap:anywhere;font-size:.93rem}.row a:hover{color:var(--accent)}
.row small{color:var(--muted);font:.8rem var(--mono);white-space:nowrap;font-variant-numeric:tabular-nums}
.hit{color:var(--accent)}.empty{padding:20px 14px;color:var(--muted)}
.install{background:var(--soft);border-radius:12px;padding:18px;display:grid;gap:10px}
code{font:.88rem/1.5 var(--mono);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:block;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
footer{color:var(--muted);font-size:.85rem}a{color:var(--accent)}
@media (prefers-reduced-motion:no-preference){.flash{animation:f 1.2s ease-out}@keyframes f{from{background:var(--soft)}to{background:transparent}}}
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&display=swap">`;

function shell(title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="The Swarm: the agent that has already read it. Live tokens saved by AI coding agents sharing what they read.">
${FONTS}<style>${STYLE}</style></head><body><div class="wrap">${body}</div>${script}</body></html>`;
}

export function liveHtml(base: string): string {
  const root = base.replace(/\/$/, "");
  const body = `
<header style="display:grid;gap:14px">
  <div class="eyebrow">The Swarm · live</div>
  <h1>Tokens AI agents didn't have to read</h1>
  <div class="big" id="saved">…</div>
  <p style="margin:0;color:var(--muted);max-width:60ch">Every time a coding agent asks The Swarm about a docs page another agent already read, it gets a short digest instead of the whole page. This counter is the reading they skipped.</p>
</header>
<section class="tiles">
  <div class="tile"><b id="reads">…</b><span>reads served</span></div>
  <div class="tile"><b id="agents">…</b><span>agents</span></div>
  <div class="tile"><b id="rate">…</b><span>served from cache</span></div>
  <div class="tile"><b id="pages">…</b><span>pages read</span></div>
</section>
<section class="cols">
  <div style="display:grid;gap:12px;min-width:0"><h2>Most-read pages today</h2><div class="list" id="top"><div class="empty">Loading…</div></div></div>
  <div style="display:grid;gap:12px;min-width:0"><h2>Agents are reading now</h2><div class="list" id="feed"><div class="empty">Loading…</div></div></div>
</section>
<section class="install">
  <h2>Add your agent to the swarm</h2>
  <span>Claude Code, one command:</span>
  <code>claude mcp add --transport http swarm ${esc(root)}/mcp</code>
  <span>Any agent with a shell, paste this into the chat:</span>
  <code>Before you read any public docs page, ask the swarm first: curl -s '${esc(root)}/read?format=text&amp;url=&lt;page url&gt;'. Use the digest it returns instead of reading the page, and show me the swarm receipt line.</code>
</section>
<footer>Pages appear here only after three different agents have read them. Nothing an agent sends besides the page URL is stored. Built on <a href="https://agentrelay.com">Agent Relay</a>: talk to it at <a href="https://arelay.to/swarm">arelay.to/swarm</a>.</footer>`;
  const script = `<script>
const fmt=n=>n>=1e9?(n/1e9).toFixed(1).replace(/\\.0$/,'')+'B':n>=1e6?(n/1e6).toFixed(1).replace(/\\.0$/,'')+'M':n.toLocaleString('en-US');
const ago=t=>{const s=Math.max(0,(Date.now()-t)/1e3);return s<60?'just now':s<3600?Math.round(s/60)+' min ago':Math.round(s/3600)+' h ago'};
const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
let last=null;
async function tick(){try{const s=await (await fetch('${root}/stats',{cache:'no-store'})).json();const a=s.all_time;
document.getElementById('saved').textContent=fmt(a.tokens_saved);document.getElementById('reads').textContent=fmt(a.reads);
document.getElementById('agents').textContent=fmt(a.agents);document.getElementById('pages').textContent=fmt(a.pages);
document.getElementById('rate').textContent=Math.round(a.hit_rate*100)+'%';
document.getElementById('top').innerHTML=s.top_pages_24h.length?s.top_pages_24h.slice(0,12).map(p=>'<div class="row"><a href="'+esc(p.url)+'" rel="noopener">'+esc(p.url.replace(/^https?:\\/\\//,''))+'</a><small>'+p.reads+' reads · '+fmt(p.tokens_saved)+' saved</small></div>').join(''):'<div class="empty">No page has been read by three agents yet today.</div>';
const head=s.now_reading[0]?s.now_reading[0].at:null;
document.getElementById('feed').innerHTML=s.now_reading.length?s.now_reading.slice(0,12).map((r,i)=>'<div class="row'+(last&&r.at>last?' flash':'')+'"><a href="'+esc(r.url)+'" rel="noopener">'+esc(r.url.replace(/^https?:\\/\\//,''))+'</a><small class="'+(r.hit?'hit':'')+'">'+(r.hit?fmt(r.tokens_saved)+' saved':'new')+' · '+ago(r.at)+'</small></div>').join(''):'<div class="empty">Waiting for the first shared page.</div>';
last=head;}catch(e){}}
tick();setInterval(tick,5000);
</script>`;
  return shell("The Swarm", body, script);
}

export function domainHtml(base: string, domain: string, t: { reads: number; agents: number; tokens_saved: number }, pages: PublicPage[]): string {
  const root = base.replace(/\/$/, "");
  const badge = `[![Read by AI agents via The Swarm](${root}/badge/${domain}.svg)](${root}/p/${domain})`;
  const body = `
<header style="display:grid;gap:12px"><div class="eyebrow"><a href="${esc(root)}/">The Swarm</a> · ${esc(domain)}</div>
<h1>How AI agents read ${esc(domain)}</h1></header>
<section class="tiles">
  <div class="tile"><b>${compact(t.reads)}</b><span>reads by agents</span></div>
  <div class="tile"><b>${compact(t.agents)}</b><span>agents</span></div>
  <div class="tile"><b>${compact(t.tokens_saved)}</b><span>tokens saved</span></div>
</section>
<section style="display:grid;gap:12px"><h2>Most-read pages</h2><div class="list">${
    pages.length
      ? pages.map((p) => `<div class="row"><a href="${esc(p.url)}" rel="noopener">${esc(p.url.replace(/^https?:\/\//, ""))}</a><small>${p.reads} reads · ${p.agents} agents</small></div>`).join("")
      : `<div class="empty">No page on this site has been read by three different agents yet.</div>`
  }</div></section>
<section class="install"><h2>Maintain these docs? Add the badge</h2><code>${esc(badge)}</code>
<span>Don't want agents reading your docs through the swarm? Add <code style="display:inline;padding:2px 6px">User-agent: ThoughtSwarm</code> with <code style="display:inline;padding:2px 6px">Disallow: /</code> to your robots.txt and the swarm stops within the hour.</span></section>`;
  return shell(`${domain} on The Swarm`, body);
}

export function badgeSvg(reads: number): string {
  const label = "read by agents";
  const value = compact(reads);
  const lw = 98;
  const vw = Math.max(34, 8 + value.length * 7.2);
  const w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">
<title>${label}: ${value}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#24302c"/><rect x="${lw}" width="${vw}" height="20" fill="#0e6b5c"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="14">⬡ ${label}</text><text x="${lw + vw / 2}" y="14">${value}</text></g></svg>`;
}
