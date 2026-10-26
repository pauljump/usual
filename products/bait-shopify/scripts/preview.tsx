// Loopback-only visual QA. This is not an authentication bypass or product route.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {Scoreboard} from '../app/components/Scoreboard';
import type {Score} from '../app/bait/store.server';
import {generateCatalog,rootDoor} from '../app/bait/catalog.server';
const at=new Date().toISOString();
const score:Score={enabled:false,since:at,generatedAt:at,lastRecordedAt:null,requests:0,records:0,bytes:'0',deepRequests:0,deepest:0,today:0,dailyCap:2000,sharing:false,recent:[],measurement:'Local UI preview. No live traffic.'};
const css=readFileSync(new URL('../app/styles/bait.css',import.meta.url),'utf8');
const controls=<div className="bait-controls"><div className="bait-step"><b>1</b><p><a href="#setup">Enable the catalog door ↗</a><br/>Turn on Bait in App embeds, then save your theme.</p></div><div className="bait-step"><b>2</b><p>Turn on the traps here. Only visits to the fake catalog are recorded.</p></div><label className="bait-consent"><input type="checkbox" disabled/>Confirm setup inside Shopify to activate. Local preview cannot change a store.</label><button className="bait-receipt-button" disabled>Turn on the traps</button><div className="bait-control-links"><a href="/bait-example">Peek at the bait ↗</a></div><p className="bait-note">Previewing never changes the score.</p></div>;
const previewPage=()=>{const page=renderToStaticMarkup(<div className="bait-local-frame"><header className="bait-local-header"><span>usual. / Bait for Shopify</span><span>Local interface preview · not installed</span></header><Scoreboard score={score} controls={controls} preview receipt={<button className="bait-receipt-button" disabled>Download receipt ↗</button>}/></div>);
return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bait for Shopify — local preview</title><style>body{margin:0;background:#f1f2ed}a{color:#3a632c}${css}</style></head><body>${page}</body></html>`};
if(process.argv.includes('--write')){mkdirSync('/tmp/bait-shopify-review-20260928',{recursive:true});writeFileSync('/tmp/bait-shopify-review-20260928/index.html',previewPage());console.log('/tmp/bait-shopify-review-20260928/index.html');process.exit(0)}
createServer((req,res)=>{
  if(req.url==='/bait-example'){const output=generateCatalog('preview.myshopify.com','local-design-preview-only','/apps/bait',rootDoor(),'archive');res.writeHead(200,{'Content-Type':'text/html'}).end(output.body.replace('<main>','<main><p><strong>LOCAL EXAMPLE · FICTIONAL DATA · NOT RECORDED</strong></p>'));return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(previewPage());
}).listen(3107,'127.0.0.1',()=>console.log('Local Bait interface preview: http://127.0.0.1:3107'));
