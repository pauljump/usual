import type { ActionFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { baitStore } from '../bait/store.server';
export async function action({request}:ActionFunctionArgs) {
  const {shop,topic}=await authenticate.webhook(request);
  if (topic!=='APP_UNINSTALLED') return new Response(null,{status:400});
  await baitStore(db).erase(shop);
  return new Response(null,{status:200});
}
