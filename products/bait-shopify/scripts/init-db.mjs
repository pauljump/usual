import {openSync,closeSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
process.umask(0o077);
const url=process.env.DATABASE_URL||'';
if (!url.startsWith('file:/') || url.includes('?')) throw Error('Set DATABASE_URL to file:/absolute/private/path/bait-shopify.sqlite outside the repository.');
const path=resolve(url.slice(5)),root=resolve(new URL('../',import.meta.url).pathname);
if (path.startsWith(root+'/')) throw Error('Runtime data must live outside the source repository.');
mkdirSync(dirname(path),{recursive:true,mode:0o700});closeSync(openSync(path,'a',0o600));
