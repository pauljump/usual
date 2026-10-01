import { generateCatalog, readDoor, rootDoor, proxyPrefix, clientFamily } from './catalog.server';
import type { baitStore } from './store.server';
type Store = ReturnType<typeof baitStore>;
type Authenticator = (request: Request) => Promise<{session?: {shop:string}; admin?: unknown}>;
const headers = {'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff'};
export function createProxyHandler({authenticate,store,nowMs=Date.now}:{authenticate:Authenticator;store:Store;nowMs?:()=>number}) {
  return async (request: Request) => {
    if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:{...headers,Allow:'GET, HEAD'}});
    // Authenticate every proxy request before touching any tenant state.
    const context = await authenticate(request);
    if (!context.session || !context.admin) return new Response(null,{status:404,headers});
    const shop=context.session.shop, url=new URL(request.url);
    const stamp=Number(url.searchParams.get('timestamp'))*1000;
    if (!Number.isFinite(stamp) || Math.abs(nowMs()-stamp)>300000 || url.searchParams.get('shop')!==shop)
      return new Response(null,{status:401,headers});
    const prefix=proxyPrefix(url.searchParams.get('path_prefix'));
    const match=url.pathname.match(/^\/proxy\/(catalog|archive)(?:\/([\w.-]{1,512}))?\/?$/);
    if (!prefix || !match) return new Response(null,{status:404,headers});
    const config=await store.settings(shop);
    if (!config?.enabled) return new Response(null,{status:404,headers});
    const door=match[2]?readDoor(shop,config.secret,match[2],nowMs()):rootDoor(nowMs());
    if (!door || door.d>=1000000) return new Response(null,{status:404,headers});
    const output=generateCatalog(shop,config.secret,prefix,door,match[1] as 'catalog'|'archive');
    const responseHeaders={...headers,'Content-Type':output.type,
      'Content-Security-Policy':"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
    if (request.method==='HEAD') return new Response(null,{headers:responseHeaders});
    try {
      const outcome=await store.record(shop,config.secret,output,clientFamily(request.headers.get('user-agent')));
      if (outcome!=='recorded') return new Response(null,{status:outcome==='budget'?429:404,headers:{...headers,'Retry-After':'900'}});
    } catch {
      // No invented counts or retries on store failure; this app path fails closed.
      return new Response(null,{status:503,headers:{...headers,'Retry-After':'300'}});
    }
    return new Response(output.body,{headers:responseHeaders});
  };
}
