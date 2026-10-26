import {it,expect} from 'vitest';
import {inflateSync} from 'node:zlib';
import {setup,pageHtml} from './helpers.js';
const source='https://example.com/a';
it('creates stable share links, pins a version, and exposes crawler metadata without extra model calls or reads',async()=>{
 const {app,web,swarm,digester,store}=await setup();
 web.pages.set(source,{body:pageHtml('Original version.')});await swarm.read(source,'reader');
 const make=(url:string)=>app.handle(new Request('https://swarm.example/share',{method:'POST',body:JSON.stringify({url})}));
 const info=await (await make(source)).json() as any;
 expect(info.url).toMatch(/^https:\/\/swarm.example\/s\/[a-f0-9]{16}$/);
 expect(await (await make(source)).json()).toEqual(info);
 expect(await (await make('https://swarm.example/document?url='+encodeURIComponent(source))).json()).toEqual(info);
 expect(await (await make(info.url)).json()).toEqual(info);
 web.pages.clear();
 const before=await store.totals(0);
 for(const agent of ['Twitterbot','facebookexternalhit','browser']) {
  const r=await app.handle(new Request(info.url,{headers:{'user-agent':agent}}));
  expect(r.status).toBe(200);const html=await r.text();
  expect(html).toContain('content="summary_large_image"');expect(html).toContain(`property="og:image" content="${info.image_url}"`);expect(html).toContain(`rel="canonical" href="${info.url}"`);
 }
 const image=await app.handle(new Request(info.image_url));expect(image.headers.get('content-type')).toBe('image/png');
 const png=Buffer.from(await image.arrayBuffer());expect([...png.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);expect(png.readUInt32BE(16)).toBe(1200);expect(png.readUInt32BE(20)).toBe(630);
 let offset=8,idat:Buffer[]=[];while(offset<png.length){const n=png.readUInt32BE(offset);if(png.toString('ascii',offset+4,offset+8)==='IDAT')idat.push(png.subarray(offset+8,offset+8+n));offset+=n+12;}
 expect(inflateSync(Buffer.concat(idat)).length).toBe(1201*630);
 expect((await app.handle(new Request(info.image_url,{method:'HEAD'}))).status).toBe(200);
 expect(await store.totals(0)).toEqual(before);expect(digester.calls).toBe(1);
 web.pages.set(source,{body:pageHtml('New version.')});await swarm.read(source,'reader',{refresh:true});
 const next=await (await make(source)).json() as any;expect(next.url).not.toBe(info.url);
 const oldHtml=await (await app.handle(new Request(info.url))).text();expect(oldHtml).toContain('Original version.');expect(oldHtml).not.toContain('New version.');
 const oldText=await (await app.handle(new Request(info.url+'?format=text'))).text();expect(oldText).toContain('Original version.');expect(oldText).not.toContain('New version.');expect(digester.calls).toBe(2);
});
it('rejects unsaved and private sources without fetching or inference',async()=>{
 const {app,web,digester}=await setup();
 for(const [url,status] of [[source,404],['http://127.0.0.1/private',400],['not a URL',400]] as const){
  const r=await app.handle(new Request('https://swarm.example/share',{method:'POST',body:JSON.stringify({url})}));expect(r.status).toBe(status);
 }
 expect((await app.handle(new Request('https://swarm.example/s/aaaaaaaaaaaaaaaa'))).status).toBe(404);
 expect(web.requests).toHaveLength(0);expect(digester.calls).toBe(0);
});
it('escapes untrusted titles in share metadata and HTML',async()=>{
 const {swarm,app}=await setup();
 await swarm.ingest({url:source,title:'"><script>alert(1)</script>',text:'Some text',contentType:'text/plain'},'seed',{seed:true});
 const r=await app.handle(new Request('https://swarm.example/document?url='+source));const html=await r.text();
 expect(html).not.toContain('<script>alert(1)</script>');expect(html).toContain('&lt;script&gt;');
});
