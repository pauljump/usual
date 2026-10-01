"""Private loopback UI for Learn: evidence-based assessment and playbook review.

Adapts Groundwork's Verify pattern (dev-sentiment-takehome/dashboard/verify.js): the cited
passage is highlighted inside its surrounding source text, the model's reading and its
rationale sit beside it, and the human picks or supplies the answer. Revisions are checked,
history is append-only and every answer can be undone. A fresh in-memory capability guards
every data request, as in Usual's run review server.
"""
import hmac
import json
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

PAGE = r'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Usual · Learn</title><style>
:root{--paper:#f5f3ed;--card:#fffefa;--ink:#24392f;--muted:#5b685f;--line:#d6dbd0;--green:#344f40;--hl:#f4d35e;--contra:#f5a68c;--ctx:#c7dcf2;--mine:#b8dc8f}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,sans-serif}
header{position:sticky;top:0;z-index:5;display:flex;gap:16px;align-items:center;padding:10px 18px;background:var(--card);border-bottom:1px solid var(--line)}
header strong{font:22px Georgia,serif}nav button{background:transparent;color:var(--green);border:0;font-weight:600;padding:8px 10px;cursor:pointer}nav button.on{border-bottom:3px solid var(--green)}
.progress{margin-left:auto;font-size:13px;color:var(--muted)}#status{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--ink);color:#e9f5b8;padding:8px 14px;border-radius:999px;font-size:14px;opacity:0;transition:.2s;pointer-events:none}#status.show{opacity:1}
.body{display:grid;grid-template-columns:minmax(0,1fr) 440px;align-items:start}.doc{padding:18px 26px 80px;min-width:0}.panel{position:sticky;top:57px;height:calc(100vh - 57px);overflow:auto;border-left:1px solid var(--line);background:var(--card);padding:16px}
.rec{border:1px solid var(--line);border-radius:10px;background:var(--card);margin:10px 0}.rec summary{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;cursor:pointer;font-size:13px}
.rec pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:10px 12px 14px;border-top:1px solid var(--line);font:14.5px/1.6 system-ui}.before{color:var(--muted);font-size:13px;border-left:3px solid var(--line);margin:8px 12px;padding:2px 10px;white-space:pre-wrap}
mark{border-radius:3px;padding:1px 0}mark.q-supports{background:var(--hl)}mark.q-contrary{background:var(--contra)}mark.q-context{background:var(--ctx)}
.chip{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;border-radius:999px;padding:3px 9px;background:#e6e8df;color:var(--muted)}
.chip.human{background:#d5ead9;color:#1f5a3b}.chip.assistant,.chip.assistant_note{background:#e3dcf7;color:#4a3a86}.chip.document{background:#e8e6f5}.chip.supports{background:#fbeeb5;color:#6b5500}.chip.contrary{background:#f7d6d0;color:#8b2f22}.chip.context{background:#dde9f7;color:#244a73}
.prov{color:var(--muted);font-size:12px;margin-left:auto}h1{font:26px/1.2 Georgia,serif;margin:6px 0 4px}h2{font-size:13px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin:18px 0 6px}
.layer{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:10px 0;background:var(--paper)}.layer>b{display:block;font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.statement{font-size:18px;font-weight:600;margin:4px 0}.muted{color:var(--muted);font-size:13px}.opts label{display:flex;gap:8px;align-items:flex-start;padding:9px 10px;border:1px solid var(--line);border-radius:8px;margin:6px 0;background:var(--card);cursor:pointer}.opts label.agent{border-color:#b08a55}
button.act{cursor:pointer;font:600 14px system-ui;padding:10px 12px;border:1px solid var(--green);border-radius:7px;background:var(--green);color:#fff}button.alt{background:transparent;color:var(--green)}button:disabled{opacity:.5}
.row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.row button{flex:1 1 auto}textarea,input[type=text]{width:100%;font:15px system-ui;padding:8px;border:1px solid #9aa895;border-radius:7px;margin:6px 0}
.keys{font-size:12px;color:var(--muted);margin-top:14px}.empty{padding:80px 24px;text-align:center;color:var(--muted)}
.pb-list button{display:block;width:100%;text-align:left;margin:6px 0;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);cursor:pointer}.pb-list button.on{border-color:var(--green);box-shadow:0 0 0 2px #cfe0c9}
.diff{font:13px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px}.diff .add{background:#e2f2dc;display:block}.diff .del{background:#f8e0da;display:block}
.pb h3{margin:16px 0 4px;font-size:15px}.pb ol,.pb ul{margin:4px 0 4px 20px;padding:0}.pb pre{background:#eef0e8;padding:8px;border-radius:6px;white-space:pre-wrap}
a{color:var(--green)}:focus-visible{outline:3px solid #ba613e;outline-offset:2px}
@media(max-width:960px){.body{grid-template-columns:1fr}.panel{position:static;height:auto;border-left:0;order:-1}}
</style></head><body>
<header><strong>Usual · Learn</strong><nav><button id="tab-assess" class="on">Assess</button><button id="tab-playbooks">Playbooks</button></nav><span class="progress" id="progress"></span></header>
<div class="body"><section class="doc" id="doc" aria-label="Source evidence"></section><aside class="panel" id="panel" aria-label="Assessment"></aside></div>
<div id="status" role="status" aria-live="polite"></div>
<script>
'use strict';
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
const $=id=>document.getElementById(id),doc=$('doc'),panel=$('panel');
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined&&text!==null)n.textContent=String(text);return n};
const btn=(label,fn,cls='act',parent)=>{const b=el('button',cls,label);b.type='button';b.onclick=fn;if(parent)parent.append(b);return b};
function say(t){const s=$('status');s.textContent=t;s.classList.add('show');clearTimeout(say.t);say.t=setTimeout(()=>s.classList.remove('show'),2600)}
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const x=await r.json();if(!r.ok)throw Error(x.error||'Request failed');return x}
let queue=null,current=null,shownAt=0,lastAnswered=null,view='assess',busy=false;
const AUTH={human:'Human',assistant:'Assistant',assistant_note:'Assistant note',document:'Document',usual:'Usual'};
// Highlight every cited quote inside its surrounding, unhighlighted text (Groundwork Verify's painter).
function passage(textValue,quotes,full){const ranges=[];for(const q of quotes){const at=textValue.indexOf(q.quote);if(at>=0)ranges.push({a:at,b:at+q.quote.length,stance:q.stance})}
 ranges.sort((x,y)=>x.a-y.a);const kept=[];for(const r of ranges){if(!kept.length||r.a>=kept[kept.length-1].b)kept.push(r)}
 let lo=0,hi=textValue.length;if(!full&&textValue.length>1600){lo=Math.max(0,(kept[0]?kept[0].a:0)-600);hi=Math.min(textValue.length,Math.max(lo+1600,(kept.length?kept[kept.length-1].b:0)+600))}
 const frag=document.createDocumentFragment();let at=lo;if(lo)frag.append('…');
 for(const r of kept){if(r.b<=lo||r.a>=hi)continue;frag.append(textValue.slice(at,Math.max(at,r.a)));const m=el('mark','q-'+r.stance,textValue.slice(Math.max(r.a,lo),Math.min(r.b,hi)));m.title=r.stance;frag.append(m);at=Math.min(r.b,hi)}
 frag.append(textValue.slice(at,hi)+(hi<textValue.length?'…':''));return frag}
function record(group){const s=group.source;const stances=[...new Set(group.quotes.map(q=>q.stance))];const d=el('details','rec');d.open=true;const sm=el('summary');
 sm.append(el('span','chip '+s.author,AUTH[s.author]||s.author));for(const st of stances)sm.append(el('span','chip '+st,st));sm.append(el('span','',(s.date||'undated').slice(0,10)+(s.project?' · '+s.project:'')));
 sm.append(el('span','prov',(s.path?s.path.split('/').slice(-2).join('/')+':'+(s.line||''):s.ref)));d.append(sm);
 for(const b of (s.context||[]).slice(0,1)){if(b.text){const p=el('div','before');p.append(el('b','',(b.role==='assistant'?'Before this, the assistant wrote':b.role==='heading'?'Section':'Before this')+': '),(b.text.length>700?b.text.slice(0,700)+'…':b.text));d.append(p)}}
 const pre=el('pre');pre.append(passage(s.text,group.quotes,false));d.append(pre);
 if(s.text.length>1600){btn('Show full source',()=>{pre.replaceChildren(passage(s.text,group.quotes,true))},'alt',d)}return d}
function grouped(citations){const by=new Map();for(const c of citations){if(!by.has(c.source.id))by.set(c.source.id,{source:c.source,quotes:[]});by.get(c.source.id).quotes.push({quote:c.quote,stance:c.stance})}
 const rank=g=>Math.min(...g.quotes.map(q=>({supports:0,contrary:1,context:2})[q.stance]));return [...by.values()].map(g=>({...g,rank:rank(g)}))}
async function loadQueue(){queue=await api('/api/queue?limit=50');const p=queue.progress;$('progress').textContent=`${p.answered} answered · ${p.pending} to assess · ${p.uninterpreted_candidates} not yet interpreted`}
async function showNext(id){try{await loadQueue();const next=id||queue.items[0]?.id;if(!next){current=null;doc.replaceChildren(el('div','empty','Nothing to assess right now. Unasked history stays observed context — it is never promoted without your review.'));panel.replaceChildren(lastAnswered?btn('Undo last answer',undo,'alt'):'');return}current=await api('/api/item/'+encodeURIComponent(next));shownAt=Date.now();renderItem()}catch(e){say(e.message)}}
function renderItem(){const it=current,L=it.learning;doc.replaceChildren();
 doc.append(el('span','chip',L.kind.replaceAll('_',' ')),el('span','muted',' · priority '+it.priority+' — '+it.priority_reason));
 doc.append(el('h1','',L.candidate?L.candidate.title:'Learning'),el('p','muted',L.candidate?L.candidate.observation:''));
 const all=grouped(L.citations);doc.append(el('p','muted','Highlights: yellow supports the reading, salmon contradicts it, blue is context.'));
 for(const [title,rank] of [['Supporting evidence',0],['Contrary evidence',1],['Context',2]]){const gs=all.filter(g=>g.rank===rank);if(!gs.length)continue;doc.append(el('h2','',title+' ('+gs.length+')'));for(const g of gs)doc.append(record(g))}
 panel.replaceChildren();panel.append(el('h2','','Question'),el('p','statement',it.prompt));
 const says=el('div','layer');says.append(el('b','','1 · What the sources say'));const by={};for(const c of L.citations)by[c.source.author+' '+c.stance]=(by[c.source.author+' '+c.stance]||0)+1;
 says.append(el('div','',Object.entries(by).map(([k,v])=>v+' '+k.replace('_',' ')).join(' · ')));says.append(el('div','muted','Quotes are highlighted in their original text at left. Assistant turns are suggestions or reported outcomes, not your decisions.'));panel.append(says);
 const infers=el('div','layer');infers.append(el('b','','2 · What the agent infers'),el('div','statement',L.statement));
 const why=el('details');why.append(el('summary','','Why the agent inferred this'),el('p','',L.rationale));infers.append(why);
 infers.append(el('div','muted',`Confidence: ${L.confidence} (the agent's judgment) · by ${L.agent} · scope: ${(L.scope.projects||[]).join(', ')||'global'}${L.scope.context?' — '+L.scope.context:''}`));
 if(L.exceptions.length){const ul=el('ul');for(const x of L.exceptions)ul.append(el('li','',x));infers.append(el('div','muted','Exceptions it noted:'),ul)}panel.append(infers);
 const conf=el('div','layer');conf.append(el('b','','3 · What you confirm'));
 if(!['candidate','deferred'].includes(L.status)){conf.append(el('p','',`Answered: ${L.status}. Current reading: “${L.effective_statement}”`));btn('Undo this answer',undo,'alt',conf)}
 else{const opts=el('div','opts');it.options.forEach((o,i)=>{const lab=el('label',i===0&&it.format==='mc'?'agent':'');const r=el('input');r.type='radio';r.name='opt';r.value=i;lab.append(r,el('span','',(i===0&&it.format==='mc'?'Agent’s reading: ':'')+o));opts.append(lab)});conf.append(opts);
  const note=el('textarea');note.rows=2;note.placeholder='Optional note (why, or what it depends on)';note.id='note';conf.append(note);
  const row=el('div','row');btn('Save answer',()=>{const v=document.querySelector('input[name=opt]:checked');if(!v){say('Pick an option, or use a button below.');return}const i=Number(v.value);answer(it.format==='tf'?(i===0?'confirmed':'rejected'):(i===0?'confirmed':'corrected'),{choice:i})},'act',row);conf.append(row);
  const more=el('div','row');btn('Correct it…',()=>ask('Correct statement','corrected','statement'),'alt',more);btn('Limit its scope…',()=>ask('Where does it apply?','narrowed','scope'),'alt',more);
  btn('Outdated',()=>answer('outdated'),'alt',more);btn('Not enough evidence',()=>answer('insufficient'),'alt',more);btn('Don’t learn this',()=>answer('rejected'),'alt',more);btn('Skip for now',()=>answer('deferred'),'alt',more);conf.append(more);
  const extra=el('div');extra.id='extra';conf.append(extra)}
 panel.append(conf);
 const ver=el('div','layer');ver.append(el('b','','4 · What execution verifies'));const lv=L.layers.execution_verifies;ver.append(el('div','muted',Array.isArray(lv)?lv.map(v=>`${v.slug} v${v.version}: ${v.kind} ${v.passed?'passed':'failed'} (${v.created.slice(0,10)})`).join('\n'):'Nothing yet. Your confirmation establishes intent and scope; it does not prove a procedure works.'));panel.append(ver);
 if(lastAnswered)btn('Undo last answer',undo,'alt',panel);panel.append(el('p','keys','Keys: 1–4 choose · Enter save · c correct · s scope · o outdated · i insufficient · x don’t learn · k skip · u undo. Progress saves with every answer; stop any time.'))}
function ask(label,verdict,field){const box=$('extra');box.replaceChildren(el('label','',label));const t=el('textarea');t.rows=3;t.value=field==='statement'?current.learning.statement:'';box.append(t);btn('Save',()=>{if(!t.value.trim()){say('Enter the '+(field==='statement'?'correct statement':'scope'));return}answer(verdict,{[field]:t.value.trim()})},'act',box);t.focus()}
async function answer(verdict,extra={}){if(busy||!current)return;busy=true;try{const L=current.learning;await api('/api/answer',{id:current.id,verdict,revision:L.revision,note:($('note')||{}).value||'',elapsed_ms:Date.now()-shownAt,...extra});lastAnswered=L.id;say(verdict==='deferred'?'Skipped; it stays in the queue.':'Saved. Only your answer changes what Usual learns.');await showNext()}catch(e){say(e.message)}finally{busy=false}}
async function undo(){if(busy||!lastAnswered)return;busy=true;try{const L=await api('/api/item/'+encodeURIComponent(lastAnswered));await api('/api/undo',{learning:lastAnswered,revision:L.learning.revision});say('Reversed; history kept.');const id=lastAnswered;lastAnswered=null;await showNext(L.id)}catch(e){say(e.message)}finally{busy=false}}
document.addEventListener('keydown',e=>{if(view!=='assess'||!current||e.target.matches('textarea,input')&&e.key!=='Enter')return;if(e.target.matches('textarea'))return;const n=Number(e.key);
 if(n>=1&&n<=4){const r=document.querySelectorAll('input[name=opt]')[n-1];if(r)r.checked=true}else if(e.key==='Enter'){const v=document.querySelector('input[name=opt]:checked');if(v){e.preventDefault();const i=Number(v.value);answer(current.format==='tf'?(i===0?'confirmed':'rejected'):(i===0?'confirmed':'corrected'),{choice:i})}}
 else if(e.key==='c')ask('Correct statement','corrected','statement');else if(e.key==='s')ask('Where does it apply?','narrowed','scope');else if(e.key==='o')answer('outdated');else if(e.key==='i')answer('insufficient');else if(e.key==='x')answer('rejected');else if(e.key==='k')answer('deferred');else if(e.key==='u')undo()});
// ---------------- playbooks
let pbSelected=null;
function section(parent,title,items,ordered){if(!items||!items.length)return;parent.append(el('h3','',title));const l=el(ordered?'ol':'ul');for(const x of items)l.append(el('li','',typeof x==='string'?x:(x.criterion+(x.check?' — check '+JSON.stringify(x.check):''))));parent.append(l)}
async function showPlaybooks(id){try{const list=await api('/api/playbooks');doc.replaceChildren();panel.replaceChildren();const nav=el('div','pb-list');panel.append(el('h2','','Awaiting review'));
 const drafts=list.filter(p=>p.status==='draft'),approved=list.filter(p=>p.status==='approved');if(!drafts.length)panel.append(el('p','muted','No drafts awaiting review.'));
 for(const p of drafts)nav.append(btn(`${p.title} · ${p.slug} v${p.version} (${p.origin})`,()=>showPlaybooks(p.version_id),id===p.version_id?'on':''));panel.append(nav);
 const nav2=el('div','pb-list');panel.append(el('h2','','Approved'));for(const p of approved)nav2.append(btn(`${p.title} · v${p.version}`,()=>showPlaybooks(p.version_id),id===p.version_id?'on':''));panel.append(nav2);
 const pick=id||drafts[0]?.version_id||approved[0]?.version_id;if(!pick){doc.append(el('div','empty','No playbooks yet. A playbook is drafted only from learnings you confirmed, then comes here for a separate review.'));return}
 pbSelected=await api('/api/playbook/'+encodeURIComponent(pick));renderPlaybook()}catch(e){say(e.message)}}
function renderPlaybook(){const v=pbSelected,b=v.body;doc.replaceChildren();const pb=el('article','pb');
 pb.append(el('span','chip '+(v.status==='approved'?'human':v.status==='draft'?'supports':'contrary'),v.status),el('span','muted',` ${v.slug} · version ${v.version} · ${v.origin}${v.change_note?' · '+v.change_note:''}`),el('h1','',b.title));
 pb.append(el('h3','','Problem'),el('p','',b.problem),el('h3','','Scope'),el('p','',(b.scope.projects.length?b.scope.projects.join(', '):'Global (any project)')+(b.scope.note?' — '+b.scope.note:'')));
 section(pb,'When to use',b.when_to_use);section(pb,'When not to use',b.when_not_to_use);section(pb,'Inputs',b.inputs);section(pb,'Prerequisites',b.prerequisites);section(pb,'Steps',b.steps,true);
 for(const s of b.scripts||[]){pb.append(el('h3','',`Script: ${s.name} (${s.read_only?'read-only':'changes state'})`),el('pre','',s.body))}
 section(pb,'Expected outputs',b.outputs);section(pb,'Verification',b.verification);section(pb,'Exceptions',b.exceptions);section(pb,'Failure handling',b.failure_handling);section(pb,'When fresh judgment is needed',b.fresh_judgment);section(pb,'Needs current permission',b.permissions);section(pb,'Triggers',b.triggers);
 if(v.diff){pb.append(el('h3','','Changes from the previous version'));const d=el('div','diff');for(const line of v.diff.split('\n')){d.append(el('span',line.startsWith('+')&&!line.startsWith('+++')?'add':line.startsWith('-')&&!line.startsWith('---')?'del':'',line+'\n'))}pb.append(d)}
 pb.append(el('h3','','Reviewed learnings behind it'));for(const L of v.learnings||[]){const box=el('div','layer');box.append(el('b','',L.status+' by you'),el('div','statement',L.effective_statement));for(const c of L.citations.filter(c=>c.stance==='supports').slice(0,3)){const q=el('div','before');q.append(el('b','',(AUTH[c.source.author]||c.source.author)+' · '+(c.source.date||'').slice(0,10)+': '),c.quote);box.append(q)}pb.append(box)}
 const u=v.uses;pb.append(el('h3','','Track record'),el('p','muted',`${u.uses} uses (${u.trial_uses} trial) by ${u.agents.join(', ')||'no agent yet'} · Usual-run checks: ${u.verified_passes} passed, ${u.verified_failures} failed`));doc.append(pb);
 panel.querySelectorAll('.pb-review').forEach(x=>x.remove());const box=el('div','layer pb-review');panel.prepend(box);
 if(v.status!=='draft'){box.append(el('b','','This version is '+v.status),el('p','muted','Approved versions change only through a reviewed revision, retirement or rollback.'));return}
 box.append(el('b','','Your review'),el('p','muted','Approval makes this a default within its scope. Current instructions and exceptions still win; it grants no permission.'));
 const note=el('textarea');note.rows=2;note.placeholder='Note (optional)';box.append(note);const row=el('div','row');
 btn('Approve',()=>review('approve',{note:note.value}),'act',row);btn('Narrow scope…',()=>narrow(box,note),'alt',row);btn('Edit…',()=>edit(box,note),'alt',row);btn('Reject',()=>review('reject',{note:note.value}),'alt',row);box.append(row)}
function narrow(box,note){const f=el('div');const p=el('input');p.type='text';p.placeholder='Projects, comma-separated (blank = keep global)';p.value=pbSelected.body.scope.projects.join(', ');const n=el('input');n.type='text';n.placeholder='Where it applies';n.value=pbSelected.body.scope.note||'';f.append(p,n);btn('Save narrowed scope and approve',()=>review('narrow',{scope:{projects:p.value.split(',').map(x=>x.trim()).filter(Boolean),note:n.value},note:note.value}),'act',f);box.append(f)}
function edit(box,note){const f=el('div');const b=pbSelected.body;const fields={};f.append(el('p','muted','One item per line. Scripts and checks keep their current values.'));
 for(const [k,label] of [['title','Title'],['problem','Problem'],['when_to_use','When to use'],['when_not_to_use','When not to use'],['inputs','Inputs'],['prerequisites','Prerequisites'],['steps','Steps'],['outputs','Expected outputs'],['exceptions','Exceptions'],['failure_handling','Failure handling'],['fresh_judgment','Fresh judgment'],['permissions','Needs current permission'],['triggers','Triggers']]){
  f.append(el('label','',label));const t=el('textarea');t.rows=Array.isArray(b[k])?Math.min(8,b[k].length+1):2;t.value=Array.isArray(b[k])?b[k].join('\n'):b[k];fields[k]=t;f.append(t)}
 const collect=()=>{const out={};for(const [k,t] of Object.entries(fields))out[k]=Array.isArray(b[k])?t.value.split('\n').map(x=>x.trim()).filter(Boolean):t.value.trim();return out};
 const row=el('div','row');btn('Save edits and approve',()=>review('edit-and-approve',{body:collect(),note:note.value}),'act',row);btn('Save edits as a new draft',()=>review('edit',{body:collect(),note:note.value}),'alt',row);f.append(row);box.append(f)}
async function review(verdict,extra){if(busy)return;busy=true;try{const r=await api('/api/playbook/review',{version_id:pbSelected.id,verdict,...extra});say('Saved: '+verdict+'.');await showPlaybooks(r.id)}catch(e){say(e.message)}finally{busy=false}}
$('tab-assess').onclick=()=>{view='assess';$('tab-assess').classList.add('on');$('tab-playbooks').classList.remove('on');showNext()};
$('tab-playbooks').onclick=()=>{view='playbooks';$('tab-playbooks').classList.add('on');$('tab-assess').classList.remove('on');showPlaybooks()};
if(token)showNext();else doc.append(el('div','empty','Open the complete private link printed by `usual learn review-ui`.'));
</script></body></html>'''


def make_server(learn, port=0):
    token = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Capabilities and private evidence never enter access logs.

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
            super().end_headers()

        def reply(self, status, data):
            payload = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def allowed(self, auth=True):
            hosts = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
            origin = self.headers.get('Origin')
            if self.headers.get('Host', '') not in hosts or (origin and origin not in {f'http://{h}' for h in hosts}):
                self.reply(403, {'error': 'Only available from its local origin.'})
                return False
            if auth and not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
                self.reply(401, {'error': 'Open the complete private link printed in your terminal.'})
                return False
            return True

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == '/favicon.ico':
                self.send_response(204)
                self.end_headers()
                return
            if not self.allowed(auth=url.path != '/'):
                return
            try:
                if url.path == '/':
                    body = PAGE.encode()
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                elif url.path == '/api/queue':
                    self.reply(200, learn.queue(50))
                elif url.path.startswith('/api/item/'):
                    self.reply(200, learn.item(unquote(url.path.rsplit('/', 1)[1])))
                elif url.path == '/api/playbooks':
                    self.reply(200, learn.playbooks())
                elif url.path.startswith('/api/playbook/'):
                    version = learn.version(unquote(url.path.rsplit('/', 1)[1]))
                    version['learnings'] = [learn.learning(i) for i in version['learning_ids']]
                    self.reply(200, version)
                else:
                    self.reply(404, {'error': 'Not found'})
            except ValueError as error:
                self.reply(400, {'error': str(error)})

        def do_POST(self):
            if not self.allowed():
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 256 * 1024 or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('Invalid request')
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError('Invalid request')
                path = urlparse(self.path).path
                if path == '/api/answer':
                    result = learn.answer(data.get('id'), data.get('verdict'), revision=data.get('revision'), choice=data.get('choice'),
                                          statement=data.get('statement') or '', scope=data.get('scope') or '', note=data.get('note') or '',
                                          channel='ui', elapsed_ms=data.get('elapsed_ms'))
                elif path == '/api/undo':
                    result = learn.undo(data.get('learning'), revision=data.get('revision'), channel='ui')
                elif path == '/api/playbook/review':
                    result = learn.review_playbook(data.get('version_id'), data.get('verdict'), body=data.get('body'),
                                                   scope=data.get('scope'), note=data.get('note') or '', channel='ui')
                else:
                    self.reply(404, {'error': 'Not found'})
                    return
                self.reply(200, result)
            except (ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
                self.reply(400, {'error': str(error) or 'Could not save.'})

    return ThreadingHTTPServer(('127.0.0.1', port), Handler), token


def serve(learn, port=0):
    server, token = make_server(learn, port)
    print(f'Private assessment: http://127.0.0.1:{server.server_port}/#{token}', flush=True)
    print('Loopback only. Ctrl+C closes access; every answer is already saved.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
