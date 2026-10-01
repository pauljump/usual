import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export const RECIPE = 'catalog-v1';
export const RECORDS_PER_PAGE = 12;
export type Door = { j: string; n: string; d: number; e: number };
export type Generated = { body: string; type: string; kind: 'catalog' | 'archive'; depth: number; records: number; journey: string; bytes: number };
const hmac = (secret: string, value: string) => createHmac('sha256', secret).update(value).digest('base64url');
export function signDoor(shop: string, secret: string, door: Door) {
  const value = Buffer.from(JSON.stringify(door)).toString('base64url');
  return value + '.' + hmac(secret, `${shop}:${value}`);
}
export function readDoor(shop: string, secret: string, token: string, now = Date.now()): Door | null {
  if (token.length > 512 || !/^[\w-]+\.[\w-]+$/.test(token)) return null;
  const [value, signature] = token.split('.');
  const expected = hmac(secret, `${shop}:${value}`);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const d = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (!/^[a-f0-9]{24}$/.test(d.j) || !/^[a-f0-9]{16}$/.test(d.n) || !Number.isSafeInteger(d.d) || d.d < 0 || d.d > 1000000 || !Number.isSafeInteger(d.e) || d.e <= now || d.e > now + 8*86400000) return null;
    return d;
  } catch { return null; }
}
export function rootDoor(now = Date.now()): Door {
  return { j: randomBytes(12).toString('hex'), n: '0000000000000000', d: 0, e: now + 7*86400000 };
}
export function proxyPrefix(value: string | null): string | null {
  return value && /^\/(apps|a|tools|community)\/[a-zA-Z0-9_-]{1,30}$/.test(value) ? value : null;
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function generateCatalog(shop: string, secret: string, prefix: string, door: Door, kind: 'catalog' | 'archive'): Generated {
  const seed = hmac(secret, `${shop}:${door.n}`);
  const material = ['Linen', 'Stoneware', 'Canvas', 'Cedar', 'Wool', 'Brass'];
  const objects = ['Weekender', 'Table lamp', 'Storage basket', 'Desk tray', 'Throw', 'Vase'];
  const items = Array.from({length: RECORDS_PER_PAGE}, (_,i) => {
    const digest = createHmac('sha256', secret).update(`${seed}:${i}`).digest();
    return { id: digest.toString('hex').slice(0,16), title: material[digest[0]%6]+' '+objects[digest[1]%6],
      sku: 'ARC-'+digest.toString('hex').slice(0,10).toUpperCase(), currency: 'USD', price: (1000+digest.readUInt16BE(2)%19000)/100,
      availability: 'archived' };
  });
  const child = (branch: number, format: string) => {
    const n = createHmac('sha256', secret).update(`${door.n}:${branch}`).digest('hex').slice(0,16);
    const token = signDoor(shop, secret, {...door, n, d: door.d+1});
    return `${prefix}/${format}/${token}`;
  };
  const next = child(0,'catalog'), archive = child(1,'archive');
  const body = kind === 'catalog' ? JSON.stringify({ catalog: 'Archived collection', items, next, archive, has_more: true }) :
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catalog archive</title></head><body><main><h1>Archived collection</h1><p>Archive only. These items cannot be purchased here.</p><ul>${items.map(p=>`<li><h2>${escapeHtml(p.title)}</h2><p>${escapeHtml(p.sku)} · $${p.price.toFixed(2)} · archived</p></li>`).join('')}</ul><p><a rel="nofollow" href="${escapeHtml(next)}">Download next catalog</a></p><p><a rel="nofollow" href="${escapeHtml(archive)}">Older collection</a></p></main></body></html>`;
  return { body, type: kind === 'catalog' ? 'application/json' : 'text/html; charset=utf-8', kind, depth: door.d,
    records: items.length, journey: door.j, bytes: Buffer.byteLength(body) };
}
// Coarse, explicitly self-declared client family. No raw UA, IP, cookie or query storage.
export function clientFamily(ua: string | null) {
  if (!ua) return 'undeclared';
  if (/Googlebot|bingbot|DuckDuckBot/i.test(ua)) return 'declares-search-crawler';
  if (/GPTBot|ClaudeBot|CCBot|Bytespider/i.test(ua)) return 'declares-ai-crawler';
  if (/curl|wget|python|httpx|Go-http-client|node-fetch/i.test(ua)) return 'declares-script';
  if (/Mozilla\//i.test(ua)) return 'declares-browser';
  return 'other';
}
