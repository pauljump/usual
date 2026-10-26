// Bound to loopback for the portfolio's reviewed Cloudflare Tunnel deployment.
// Intentionally no request/access log: proxy queries can contain customer IDs.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequestHandler} from 'react-router';
import {once} from 'node:events';
import {PrismaClient} from '@prisma/client';
import {prune} from '../app/bait/retention.mjs';
process.umask(0o077);
process.env.NODE_ENV ||= 'production';
for (const name of ['SHOPIFY_API_KEY','SHOPIFY_API_SECRET','SHOPIFY_APP_URL','DATABASE_URL'])
  if (!process.env[name]) throw Error(`Missing ${name}; load application configuration with the vault runner.`);
const origin=new URL(process.env.SHOPIFY_APP_URL).origin;
const build=await import('../build/server/index.js');
const handle=createRequestHandler(build,'production');
const assets=new URL('../build/client/assets/',import.meta.url);
const types={'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  try {
    if (!req.url?.startsWith('/')||req.url.startsWith('//')) {res.writeHead(400).end();return;}
    const url=new URL(req.url,origin);
    const asset=url.pathname.match(/^\/assets\/([a-zA-Z0-9_.-]+)$/);
    if (asset && ['GET','HEAD'].includes(req.method)) {
      try {const data=await readFile(new URL(asset[1],assets));const ext='.'+asset[1].split('.').at(-1);
        res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}).end(req.method==='HEAD'?undefined:data);
      } catch {res.writeHead(404).end();}return;
    }
    let body;
    if (!['GET','HEAD'].includes(req.method)) {
      const chunks=[];let length=0;
      for await (const chunk of req) {length+=chunk.length;if(length>65536){res.writeHead(413).end();return;}chunks.push(chunk)}
      body=Buffer.concat(chunks);
    }
    const headers=new Headers();for(const [key,value] of Object.entries(req.headers))
      if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
    const controller=new AbortController();res.on('close',()=>controller.abort());
    const response=await handle(new Request(url,{method:req.method,headers,body,signal:controller.signal}));
    res.statusCode=response.status;response.headers.forEach((v,k)=>{if(k!=='set-cookie')res.setHeader(k,v)});
    const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
    if(!res.hasHeader('Cache-Control'))res.setHeader('Cache-Control','no-store');
    if(req.method==='HEAD'){await response.body?.cancel();res.end();return;}
    if(response.body)for await(const chunk of response.body){if(res.destroyed)break;if(!res.write(chunk))await once(res,'drain')}
    res.end();
  }catch{if(!res.headersSent)res.writeHead(500);res.end();console.error('Bait request failed; request contents were not logged.');}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(Number(process.env.PORT||3087),'127.0.0.1',()=>console.log(`Bait Shopify listening at http://127.0.0.1:${server.address().port}`));
// Indexed housekeeping once at startup and hourly; no model or external service.
const maintenanceDb=new PrismaClient();
const cleanup=()=>prune(maintenanceDb).catch(()=>console.error('Bait retention maintenance failed.'));
await cleanup();
const maintenanceTimer=setInterval(cleanup,3600000);maintenanceTimer.unref();
process.on('SIGTERM',()=>{clearInterval(maintenanceTimer);server.close(()=>{maintenanceDb.$disconnect().finally(()=>process.exit(0))})});
