import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {it,expect} from 'vitest';
it('renders a crawler-compatible PNG inside the Worker runtime',async()=>{
 const bundle=await build({stdin:{contents:`import {sharePng} from './src/share/image.ts'; export default {async fetch(){return new Response(await sharePng('Anthropic S-1','sec.gov',1793023513412),{headers:{'content-type':'image/png'}})}}`,resolveDir:process.cwd(),sourcefile:'image-test.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser'});
 const worker=new Miniflare({workers:[{config:{name:'share-image-test',compatibilityDate:'2026-10-01',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:bundle.outputFiles[0].text}}}}}]});
 try{const r=await worker.dispatchFetch('http://localhost/card.png');expect(r.status).toBe(200);expect(r.headers.get('content-type')).toBe('image/png');const png=Buffer.from(await r.arrayBuffer());expect(png.readUInt32BE(16)).toBe(1200);expect(png.readUInt32BE(20)).toBe(630);expect(png.length).toBeLessThan(200_000);}finally{await worker.dispose();}
},30_000);
