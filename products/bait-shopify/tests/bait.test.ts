import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {PrismaClient} from '@prisma/client';
import {baitStore,SHOP_DAILY_CAP,GLOBAL_DAILY_CAP,TRACE_CAP} from '../app/bait/store.server';
import {generateCatalog,readDoor,rootDoor,signDoor,proxyPrefix} from '../app/bait/catalog.server';
import {createProxyHandler} from '../app/bait/proxy.server';
import {receiptSvg} from '../app/bait/receipt';
const directory=mkdtempSync(join(tmpdir(),'bait-shopify-test-'));
const path=join(directory,'observations.sqlite'), sql=new DatabaseSync(path);
sql.exec(readFileSync('prisma/migrations/202609280001_initial/migration.sql','utf8'));sql.close();
const db=new PrismaClient({datasources:{db:{url:'file:'+path}}});
let now=Date.now();
const store=baitStore(db,()=>now),shop='fixture-one.myshopify.com',other='fixture-two.myshopify.com';
const init=await store.initialize(shop),second=await store.initialize(other);
const auth=async()=>({session:{shop},admin:{}});
const handler=createProxyHandler({authenticate:auth,store,nowMs:()=>now});
const request=(path='/catalog',method='GET',extra='')=>new Request(`https://app.invalid/proxy${path}?shop=${shop}&timestamp=${Math.floor(now/1000)}&path_prefix=%2Fapps%2Fbait${extra}`,{method,headers:{'user-agent':'python-requests/2.1 private-value'}});
let nextPath='';
await test('traps begin off; explicit activation precedes recording',async()=>{
  assert.equal((await handler(request())).status,404);
  assert.equal((await store.score(shop)).requests,0);
  await store.enable(shop,true);
  assert((await store.settings(shop))?.consentAt);
});
await test('real accepted fetch records once; HEAD, preview and invalid routes do not count',async()=>{
  const response=await handler(request());assert.equal(response.status,200);
  const payload=await response.json();nextPath=payload.next.replace('/apps/bait','');
  assert.equal(payload.items.length,12);assert.equal(payload.has_more,true);
  assert.equal((await store.score(shop)).requests,1);
  assert.equal((await handler(request('', 'GET'))).status,404);
  assert.equal((await handler(request('/catalog','HEAD'))).status,200);
  assert.equal((await handler(request('/catalog','POST'))).status,405);
  generateCatalog(shop,init.secret,'/apps/bait',rootDoor(now),'archive');
  assert.equal((await store.score(shop)).requests,1);
});
await test('follow-up is deterministic, linked and depth-counted; no live Shopify products',async()=>{
  const one=await(await handler(request(nextPath))).json();
  const two=await(await handler(request(nextPath))).json();
  assert.deepEqual(one,two);
  await handler(request(one.next.replace('/apps/bait','')));
  const score=await store.score(shop);assert.equal(score.deepRequests,1);assert.equal(score.deepest,2);
  assert.equal(score.records,score.requests*12);assert(BigInt(score.bytes)>0n);
  assert.equal(new Set(score.recent.map(e=>e.journey)).size,1);
  assert.equal((await store.score(other)).requests,0);
});
await test('signatures reject tampering, cross-store use and expired doors',async()=>{
  const token=signDoor(shop,init.secret,rootDoor(now));
  assert(readDoor(shop,init.secret,token,now));
  assert.equal(readDoor(other,second.secret,token,now),null);
  assert.equal(readDoor(shop,init.secret,token+'a',now),null);
  assert.equal(readDoor(shop,init.secret,token,now+8*86400000),null);
  const bad=await handler(request('/catalog/'+token+'a'));assert.equal(bad.status,404);
  assert.equal(proxyPrefix('//evil.test'),null);assert.equal(proxyPrefix('/apps/bait"><script>'),null);
  assert.equal(proxyPrefix('/tools/custom-archive'),'/tools/custom-archive');
});
await test('unauthenticated, uninstalled, stale and cross-tenant proxy requests cannot collect',async()=>{
  const no=createProxyHandler({authenticate:async()=>({}),store,nowMs:()=>now});
  assert.equal((await no(request())).status,404);
  const rejected=createProxyHandler({authenticate:async()=>{throw new Response(null,{status:401})},store,nowMs:()=>now});
  await assert.rejects(rejected(request()),e=>e instanceof Response&&e.status===401);
  const stale=new URL(request().url);stale.searchParams.set('timestamp','1');assert.equal((await handler(new Request(stale))).status,401);
  stale.searchParams.set('timestamp',String(Math.floor(now/1000)));stale.searchParams.set('shop',other);
  assert.equal((await handler(new Request(stale))).status,401);
});
await test('stored and exported records exclude request identifiers and secrets',async()=>{
  const data=JSON.stringify(await store.score(shop));
  for(const value of ['private-value',init.secret,'user-agent','logged_in_customer_id','accessToken'])assert(!data.includes(value));
  assert(data.includes('declares-script'));assert.equal((await store.score(shop)).sharing,false);
  assert(receiptSvg(await store.score(shop)).includes('Requests may include humans and retries'));
});
await test('shop budget stops responses; failed reservation rolls back all counters',async()=>{
  const day=new Date(now).toISOString().slice(0,10),before=await store.score(shop);
  await db.baitBudget.update({where:{id:`${shop}:${day}`},data:{requests:SHOP_DAILY_CAP}});
  assert.equal((await handler(request())).status,429);
  assert.equal((await store.score(shop)).requests,before.requests);
  await db.baitBudget.update({where:{id:`${shop}:${day}`},data:{requests:0}});
  await db.baitBudget.update({where:{id:`global:${day}`},data:{requests:GLOBAL_DAILY_CAP}});
  assert.equal((await handler(request())).status,429);
  assert.equal((await db.baitBudget.findUniqueOrThrow({where:{id:`${shop}:${day}`}})).requests,0);
  now+=86400000;assert.equal((await handler(request())).status,200);
});
await test('trace ring is bounded and retention preserves lifetime totals',async()=>{
  const output=generateCatalog(shop,init.secret,'/apps/bait',rootDoor(now),'catalog');
  for(let i=0;i<TRACE_CAP+5;i++)assert.equal(await store.record(shop,init.secret,output,'other'),'recorded');
  assert.equal(await db.baitEvent.count({where:{shop}}),TRACE_CAP);
  const before=await store.score(shop);now+=8*86400000;
  assert.equal((await store.score(shop)).recent.length,0);
  await store.prune();assert.equal(await db.baitEvent.count({where:{shop}}),0);
  assert.equal((await store.score(shop)).requests,before.requests);
});
await test('pause closes existing doors; repeated erasure isolates the merchant',async()=>{
  await store.enable(shop,false);assert.equal((await handler(request())).status,404);
  await store.erase(shop);await store.erase(shop);
  assert.equal(await store.settings(shop),null);assert(await store.settings(other));
});
await test('database outage returns unavailable without pretending to serve recorded loot',async()=>{
  const broken=createProxyHandler({authenticate:async()=>({session:{shop:other},admin:{}}),store:{...store,settings:async()=>({...second,enabled:true}),record:async()=>{throw Error('unavailable')}},nowMs:()=>now});
  const req=new URL(request().url);req.searchParams.set('shop',other);
  assert.equal((await broken(new Request(req))).status,503);
});

after(()=>db.$disconnect());
