// Reconcile the curated pack against D1, not done.txt. Heavy extraction
// happens on the Mini; the authenticated Worker handles model processing. Credentials are
// supplied by the vault runner, never read from project-local env files.
import { readFileSync, writeFileSync } from 'node:fs';

import { PageFetcher, sha256Hex } from '../src/fetcher.js';
import { SwarmStore, type SqlDb } from '../src/store.js';
import { normalizeUrl } from '../src/url.js';
const account = 'a90a0202b423bf9af3dec6e3b92d63e0';
const database = 'f44bb949-9ec7-4f42-964e-a1bcdc8d0860';
async function query(sql: string, params: unknown[] = []): Promise<any[]> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
    method:'POST', headers:{'content-type':'application/json','X-Auth-Email':process.env.CLOUDFLARE_EMAIL!, 'X-Auth-Key':process.env.CLOUDFLARE_API_KEY!},
    body:JSON.stringify({sql,params}), signal:AbortSignal.timeout(60_000),
  });
  const body:any = await res.json();
  if (!res.ok || !body.success || body.result.some((r:any)=>!r.success)) throw new Error(`D1 query failed: ${res.status} ${JSON.stringify(body.errors)}`);
  return body.result[0].results;
}
const db: SqlDb = {run:async(s,p)=>{await query(s,p);},first:async(s,p)=>(await query(s,p))[0] ?? null,all:query};
const store = new SwarmStore(db); await store.init();
const fetcher = new PageFetcher(undefined, 30_000);

const s1='https://www.sec.gov/Archives/edgar/data/2130357/000162828026067168/anthropicpbc-sx1.htm';
const urls=[...new Set([...readFileSync('seeds/urls.txt','utf8').split('\n').filter(Boolean),s1])];
const existing = new Set((await query('SELECT DISTINCT url FROM digests')).map(r=>r.url));
const results: {url:string;status:string;detail:string}[]=[];
let next=0, processed=0;
async function status(url:string,state:string,detail:string) {
  await db.run('INSERT OR REPLACE INTO library (url,collection,status,detail,checked_at) VALUES (?,?,?,?,?)', [url,url===s1?'Anthropic S-1':'Apple submission pack',state,detail,Date.now()]);
  results.push({url,status:state,detail});
  if (++processed%25===0 || processed===urls.length) console.log(JSON.stringify({processed,total:urls.length,ready:results.filter(r=>r.status==='ready').length,unavailable:results.filter(r=>r.status!=='ready').length}));
  writeFileSync('seeds/reconciliation.json',JSON.stringify({at:new Date().toISOString(),total:urls.length,results},null,2));
}
async function one(raw:string) {
  const url=normalizeUrl(raw);
  if (existing.has(url)) { await status(url,'ready','Saved digest verified in the database.'); return; }
  try {
    const page=await fetcher.fetchPage(url);
    await store.alias(url,page.url);
    const hash=await sha256Hex(page.text);
    let row=await store.latestDigest(page.url);
    if (!row || row.content_hash!==hash) {
      const response = await fetch(`https://thoughtswarm.tryusual.com/admin/ingest`, {
        method:"POST", body:JSON.stringify(page), headers:{"content-type":"application/json",authorization:`Bearer ${process.env.SWARM_ADMIN_TOKEN}`}, signal:AbortSignal.timeout(300_000),
      });
      const result:any = await response.json().catch(()=>({error:`Worker HTTP ${response.status}`}));
      if (!response.ok) throw new Error(result.error || `Worker HTTP ${response.status}`);
      row=await store.latestDigest(result.url || page.url);
      if (!row) throw new Error('Worker returned success but no stored digest was found.');
    }
    if (row.content_hash === hash) await store.saveSource(row.key,page.text);
    await status(url,'ready','Recovered during reconciliation.');
  } catch(e) {
    const detail=(e as Error).message.slice(0,400);
    if (/model API (401|403)/.test(detail)) throw e;
    console.log(JSON.stringify({url,status:'unavailable',detail}));
    await status(url,'unavailable',detail);
  }
}
await Promise.all(Array.from({length:3},async()=>{while(next<urls.length)await one(urls[next++]);}));
console.log(JSON.stringify({complete:true,total:results.length,ready:results.filter(r=>r.status==='ready').length,unavailable:results.filter(r=>r.status!=='ready').length}));
