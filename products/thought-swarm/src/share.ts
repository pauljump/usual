import type { DigestRow, SwarmStore } from './store.js';

export interface ShareInfo {
  url: string;
  image_url: string;
  title: string;
  description: string;
  image_alt: string;
}
export async function shareInfo(base:string,row:DigestRow,store:SwarmStore):Promise<ShareInfo> {
  const matches=await store.digestPrefix(row.key.slice(0,16));
  const id=matches.length===1?row.key.slice(0,16):row.key;
  const url=base.replace(/\/$/,'')+'/s/'+id;
  const digest=JSON.parse(row.digest_json);
  return {url,image_url:url+'/card.png',title:row.title,description:String(digest.summary).slice(0,200),image_alt:`${row.title} — saved ${new Date(row.created_at).toISOString().slice(0,10)}. Shared digest on Thought Swarm.`};
}
