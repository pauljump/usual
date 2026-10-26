import { fonts } from './font-data.js';

const W=1200, H=630;
type Font = { glyphs: Record<string, number[]>; pixels: Uint8Array };
let loaded: Promise<Record<string,Font>> | undefined;
async function loadFonts() {
  return loaded ??= (async()=>Object.fromEntries(await Promise.all(Object.entries(fonts).map(async([name,f])=>{
    const bytes=Uint8Array.from(atob(f.data),c=>c.charCodeAt(0));
    const pixels=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    return [name,{glyphs:f.glyphs,pixels}];
  }))))();
}
// Unicode stays intact in the HTML and image alt text. Unsupported raster glyphs
// use a question mark; common Latin scripts and punctuation are included.
function clean(s:string) { return s.normalize('NFC').replace(/\s+/g,' ').trim(); }
function width(s:string,f:Font) { return [...s].reduce((n,c)=>n+(f.glyphs[c]??f.glyphs['?'])[5],0); }
export function wrap(s:string,f:Font,max:number,lines:number):string[] {
  const out:string[]=[];let line='';
  for(const word of clean(s).slice(0,1000).split(' ')) {
    const next=line ? line+' '+word : word;
    if(width(next,f)<=max) {line=next;continue;}
    if(line) {out.push(line);line='';}
    for(const c of word) {
      if(width(line+c,f)>max && line) {out.push(line);line='';}
      line+=c;
    }
  }
  if(line.trim())out.push(line.trim());
  if(out.length>lines){out.length=lines;let last=out[lines-1];while(width(last+'…',f)>max)last=last.slice(0,-1);out[lines-1]=last+'…';}
  return out;
}
export async function sharePng(title:string,source:string,date:number):Promise<Uint8Array> {
  const f=await loadFonts(); const pixels=new Uint8Array(W*H);
  const rect=(x:number,y:number,w:number,h:number,color:number)=>{for(let yy=y;yy<y+h;yy++)pixels.fill(color,yy*W+x,yy*W+x+w);};
  function text(s:string,x:number,y:number,font:Font,group=0) {
    for(const c of s) {
      const [offset,w,h,left,top,advance]=font.glyphs[c]??font.glyphs['?'];
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
        const alpha=font.pixels[offset+yy*w+xx];const px=x+left+xx,py=y+top+yy;
        if(alpha && px>=0 && px<W && py>=0 && py<H)pixels[py*W+px]=group+Math.round(alpha*63/255);
      }
      x+=advance;
    }
  }
  rect(0,0,12,H,127);
  text('THOUGHT SWARM',60,37,f.small);
  text('READ ONCE. SHARE THE DIGEST.',60,88,f.small,64);
  rect(60,143,1080,2,15);
  wrap(title,f.title,1080,4).forEach((line,i)=>text(line,60,170+i*65,f.title));
  text(clean(source).slice(0,65),60,456,f.small);
  rect(60,513,1080,2,15);
  text('Saved '+new Date(date).toISOString().slice(0,10),60,547,f.small);
  text('thoughtswarm.tryusual.com',803,547,f.small,64);
  // Indexed PNG: 256-colour anti-aliasing palette keeps generation and transfer
  // small. Native compression avoids a WASM renderer or a paid image service.
  const palette=new Uint8Array(768),paper=[245,242,233];
  const colors=[[38,40,32],[204,72,43],[255,253,247],[56,87,68]];
  for(let group=0;group<4;group++)for(let a=0;a<64;a++)for(let c=0;c<3;c++)palette[(group*64+a)*3+c]=Math.round(paper[c]+(colors[group][c]-paper[c])*a/63);
  const scan=new Uint8Array((W+1)*H);
  for(let y=0;y<H;y++)scan.set(pixels.subarray(y*W,(y+1)*W),y*(W+1)+1);
  const compressed=new Uint8Array(await new Response(new Blob([scan]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const head=new Uint8Array(13);const dv=new DataView(head.buffer);dv.setUint32(0,W);dv.setUint32(4,H);head[8]=8;head[9]=3;
  const chunks=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('PLTE',palette),chunk('IDAT',compressed),chunk('IEND',new Uint8Array())];
  const result=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}return result;
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type:string,data:Uint8Array) {
  const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);
  let crc=0xffffffff;for(let i=4;i<out.length-4;i++)crc=crcTable[(crc^out[i])&255]^(crc>>>8);view.setUint32(out.length-4,(crc^0xffffffff)>>>0);return out;
}
