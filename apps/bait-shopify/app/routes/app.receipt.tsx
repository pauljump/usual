import type { LoaderFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { baitStore } from '../bait/store.server';
import { receiptSvg } from '../bait/receipt';
export async function loader({request}:LoaderFunctionArgs) {
  const {session}=await authenticate.admin(request);
  const score=await baitStore(db).score(session.shop);
  return new Response(receiptSvg(score),{headers:{'Content-Type':'image/svg+xml','Content-Disposition':'attachment; filename="bait-receipt.svg"','Cache-Control':'no-store'}});
}
