import type { LoaderFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { baitStore } from '../bait/store.server';
export async function loader({request}:LoaderFunctionArgs) {
  const {session}=await authenticate.admin(request);
  return Response.json(await baitStore(db).score(session.shop),{headers:{'Content-Disposition':'attachment; filename="bait-observations.json"','Cache-Control':'no-store'}});
}
