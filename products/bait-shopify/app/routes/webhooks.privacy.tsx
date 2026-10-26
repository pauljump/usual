import type { ActionFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { baitStore } from '../bait/store.server';
export async function action({request}:ActionFunctionArgs) {
  const {shop,topic}=await authenticate.webhook(request);
  if (topic==='SHOP_REDACT') await baitStore(db).erase(shop);
  else if (!['CUSTOMERS_DATA_REQUEST','CUSTOMERS_REDACT'].includes(topic)) return new Response(null,{status:400});
  // Customer IDs and customer records are never collected. No customer lookup or outbound delivery.
  return Response.json({received:true,customerLinkedRecords:0});
}
