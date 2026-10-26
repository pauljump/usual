import { it, expect } from 'vitest';
import { setup } from './helpers.js';
it('protects ingestion and serves a saved document without further source access or model work', async () => {
  const { app, digester, web, store } = await setup();
  const payload = {url:'https://example.com/filing',title:'Filing <script>',text:'# Filing\n\nVerified source text '.repeat(30)};
  const ingest = (token:string) => app.handle(new Request('https://swarm.example/admin/ingest',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(payload)}));
  expect((await ingest('wrong')).status).toBe(401);
  expect(digester.calls).toBe(0);
  expect((await ingest('admin-secret')).status).toBe(200);
  expect((await ingest('admin-secret')).status).toBe(200);
  expect(digester.calls).toBe(1);
  expect(web.requests).toHaveLength(0);
  expect((await store.totals(0)).reads).toBe(0);
  const doc = await app.handle(new Request('https://swarm.example/document?url='+encodeURIComponent(payload.url)));
  expect(doc.status).toBe(200);
  expect(await doc.text()).toContain('Filing &lt;script&gt;');
  const library=await app.handle(new Request('https://swarm.example/library',{headers:{accept:'text/html'}}));
  expect(library.status).toBe(200);
  expect((await app.handle(new Request('https://swarm.example/document?url=https://example.com/missing'))).status).toBe(404);
  expect(digester.calls).toBe(1);
});

it('rejects a private URL before trusted ingestion can call the model', async () => {
 const {app,digester}=await setup();
 const r=await app.handle(new Request('https://swarm.example/admin/ingest',{method:'POST',headers:{authorization:'Bearer admin-secret','content-type':'application/json'},body:JSON.stringify({url:'http://127.0.0.1',title:'Private',text:'Not public'})}));
 expect(r.status).toBe(400);expect(digester.calls).toBe(0);
});
