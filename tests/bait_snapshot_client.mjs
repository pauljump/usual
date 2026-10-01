import assert from 'node:assert/strict';
import { d1Store, snapshotResponder, default as worker } from '../src/usual/bait/bait.js';
import { sqliteD1 } from '../scripts/bait/sqlite-d1.mjs';
const db = sqliteD1();
await d1Store(db).stats(); // local installation only
let now = Date.now(), queries = [];
const traced = { prepare(sql) { queries.push(sql); return db.prepare(sql); }, batch: db.batch };
const store = () => d1Store(traced, { snapshotOnly: true, nowMs: () => now });
db.raw.exec("UPDATE bait_totals SET served=123, minted=456, trips=7, came_back=3; UPDATE bait_tarpit SET held_ms=12001, bytes=9876, requests=5");
for (let i=0;i<100;i++) db.raw.prepare('INSERT INTO bait_trip (at,slot,token_id) VALUES (?,?,?)').run(Math.floor(now/1000), 'database-password', 'test-'+i);
const results = await Promise.all([store().refreshSnapshot(), store().refreshSnapshot()]);
assert.equal(results.filter(r=>r.refreshed).length,1);
const score = await store().stats();
assert.equal(score.totals.scrapes,123); assert.equal(score.timeWasted.milliseconds,12001);
assert.equal(score.recent.length,20); assert.equal(score.recent[0].id,'test-99');
assert.equal(score.learning,null);
assert(!queries.some(q=>/bait_learning|bait_token|count\(\*\)/i.test(q)));
queries=[];
await store().stats(); assert.equal(queries.length,1); assert.match(queries[0], /WHERE key = 'public-snapshot'/);
const before = JSON.stringify(score);
now+=900000;
db.raw.exec('DELETE FROM bait_tarpit');
await assert.rejects(store().refreshSnapshot(), /counters unavailable/);
assert.equal(JSON.stringify(await store().stats()),before);
assert.equal((await store().refreshSnapshot()).refreshed,false);

let reads=0, fail=false;
const entries = new Map();
const cache = {async match(req) {const e=entries.get(req.url);return e && e.until>now ? e.response.clone():undefined},
 async put(req,r){entries.set(req.url,{response:r.clone(),until:now+86400000})}};
const read = async()=>{ reads++; if(fail)throw Error('quota'); return score; };
const responder=()=>snapshotResponder({cache,read,nowMs:()=>now});
const request=(q='',method='GET')=>new Request('https://example.test/bait/live/stats.json'+q,{method});
let respond=responder();
await Promise.all(Array.from({length:20},(_,i)=>respond(request('?x='+i))));
assert.equal(reads,1); assert.equal(entries.size,1);
respond=responder();
const hit=await respond(request('?another=1'));
assert.equal(reads,1); assert.equal(hit.headers.get('cache-control'),'no-store');
assert.equal(await (await respond(request('', 'HEAD'))).text(),'');
now+=300001;fail=true;
assert.deepEqual(await (await respond(request())).json(),score);
assert.equal(reads,2);
await respond(request());assert.equal(reads,2); // failure backoff
now+=86400001;respond=responder();
assert.equal((await respond(request())).status,503);
const readsAfter=reads;await respond(request());assert.equal(reads,readsAfter);
// Cron ignores other schedules and disabled configuration without any database work.
queries=[];
await worker.scheduled({cron:'* * * * *'},{BAIT_SNAPSHOTS:'true',BAIT_DB:traced});
await worker.scheduled({cron:'*/15 * * * *'},{BAIT_SNAPSHOTS:'false',BAIT_DB:traced});
assert.equal(queries.length,0);
// A missing/corrupt snapshot cannot turn into fabricated zero totals.
db.raw.exec("UPDATE bait_cache SET body='{}' WHERE key='public-snapshot'");
await assert.rejects(store().stats(),/Invalid saved snapshot/);
console.log(JSON.stringify({status:'passed',live_cloudflare:false,checks:['bounded real counters','latest twenty','global duplicate lease','point lookup only','failed rebuild retains score','failure lease backoff','concurrent and query-string cache reuse','HEAD and browser cache policy','stale fallback and retry backoff','cache eviction returns unavailable','cron gating','corrupt snapshot rejected']}));
