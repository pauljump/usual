import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
const dir=mkdtempSync(join(tmpdir(),'bait-shopify-sdk-test-')),path=join(dir,'fixture.sqlite');
const sql=new DatabaseSync(path);sql.exec(readFileSync('prisma/migrations/202609280001_initial/migration.sql','utf8'));sql.close();
// Synthetic test credentials, isolated DB, and an outbound-network tripwire.
process.env.DATABASE_URL='file:'+path;
process.env.SHOPIFY_API_KEY='fixture-api-key-only';process.env.SHOPIFY_API_SECRET='fixture-secret-only';
process.env.SHOPIFY_APP_URL='https://fixture.example';
const realFetch=globalThis.fetch;let outbound=0;
globalThis.fetch=async()=>{outbound++;throw Error('External calls forbidden in offline tests')};
const {default:db}=await import('../app/db.server');
const {authenticate}=await import('../app/shopify.server');
const {baitStore}=await import('../app/bait/store.server');
const {createProxyHandler}=await import('../app/bait/proxy.server');
const {action:uninstall}=await import('../app/routes/webhooks.app.uninstalled');
const {action:privacy}=await import('../app/routes/webhooks.privacy');
const {action:adminAction}=await import('../app/routes/app._index');
const shop='sdk-fixture.myshopify.com';
await db.session.create({data:{id:'offline_'+shop,shop,state:'fixture',isOnline:false,accessToken:'not-a-real-token',scope:'write_app_proxy'}});
const store=baitStore(db);await store.initialize(shop);await store.enable(shop,true);
const handler=createProxyHandler({authenticate:authenticate.public.appProxy,store});
function signedProxy(overrides:Record<string,string>={}){
  const data={shop,path_prefix:'/apps/bait',timestamp:String(Math.floor(Date.now()/1000)),logged_in_customer_id:'',...overrides};
  const message=Object.entries(data).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('');
  return new Request('https://fixture.example/proxy/catalog?'+new URLSearchParams({...data,signature:createHmac('sha256',process.env.SHOPIFY_API_SECRET!).update(message).digest('hex')}));
}
function webhook(topic:string,signature=true){const body=JSON.stringify({shop_domain:shop,customer:{id:123}});
 return new Request('https://fixture.example/webhooks/privacy',{method:'POST',body,headers:{'Content-Type':'application/json','X-Shopify-Shop-Domain':shop,'X-Shopify-Topic':topic,'X-Shopify-API-Version':'2026-07','X-Shopify-Webhook-Id':crypto.randomUUID(),'X-Shopify-Hmac-Sha256':signature?createHmac('sha256',process.env.SHOPIFY_API_SECRET!).update(body).digest('base64'):'invalid'}})}
await test('official Shopify SDK accepts valid signed proxy and rejects altered signatures',async()=>{
  assert.equal((await handler(signedProxy())).status,200);
  const u=new URL(signedProxy().url);u.searchParams.set('shop','someone-else.myshopify.com');
  await assert.rejects(handler(new Request(u)),e=>e instanceof Response&&e.status===400);
  await assert.rejects(handler(signedProxy({timestamp:'1'})),e=>e instanceof Response&&e.status===400);
  assert.equal((await store.score(shop)).requests,1);
});
await test('admin activation has no unauthenticated bypass',async()=>{
  await store.enable(shop,false);
  let rejected=false;
  try {
    await adminAction({request:new Request('https://fixture.example/app',{method:'POST',body:new URLSearchParams({intent:'enable',consent:'store-traps-v1'})}),params:{},context:{},url:new URL('https://fixture.example/app'),pattern:'/app'});
  } catch(e) {
    assert(e instanceof Response);rejected=true;
    // Shopify may return an HTML authentication trampoline with HTTP 200.
    if(e.status===200)assert.match(await e.text(),/shopifycloud\/app-bridge|shopify-reload/);
    else assert([302,400,401,403].includes(e.status));
  }
  assert(rejected);assert.equal((await store.settings(shop))?.enabled,false);
});
await test('privacy and uninstall endpoints verify actual webhook HMAC before deletion',async()=>{
  await assert.rejects(uninstall({request:webhook('app/uninstalled',false),params:{},context:{},url:new URL("https://fixture.example/app"),pattern:"/app"}),e=>e instanceof Response&&e.status===401);
  assert(await store.settings(shop));
  assert.equal((await privacy({request:webhook('customers/data_request'),params:{},context:{},url:new URL("https://fixture.example/app"),pattern:"/app"})).status,200);
  assert(await store.settings(shop));
  assert.equal((await uninstall({request:webhook('app/uninstalled'),params:{},context:{},url:new URL("https://fixture.example/app"),pattern:"/app"})).status,200);
  assert.equal(await store.settings(shop),null);
  assert.equal((await handler(signedProxy())).status,404);
  assert.equal((await privacy({request:webhook('shop/redact'),params:{},context:{},url:new URL("https://fixture.example/app"),pattern:"/app"})).status,200);
  assert.equal(outbound,0);
});
after(async()=>{globalThis.fetch=realFetch;await db.$disconnect()});
