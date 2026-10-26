import type { ActionFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import db from '../db.server';
export async function action({request}:ActionFunctionArgs) {
  const {shop,topic,payload}=await authenticate.webhook(request);
  if (topic!=='APP_SCOPES_UPDATE' || !Array.isArray(payload.current)) return new Response(null,{status:400});
  const scope=payload.current.filter((s:unknown)=>typeof s==='string').join(',');
  await db.session.updateMany({where:{shop},data:{scope}});
  if (!payload.current.includes('write_app_proxy')) await db.baitShop.updateMany({where:{shop},data:{enabled:false}});
  return new Response(null,{status:200});
}
