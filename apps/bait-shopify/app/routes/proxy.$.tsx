import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { baitStore } from '../bait/store.server';
import { createProxyHandler } from '../bait/proxy.server';
const handler=createProxyHandler({authenticate:authenticate.public.appProxy,store:baitStore(db)});
export const loader=({request}:LoaderFunctionArgs)=>handler(request);
export const action=({request}:ActionFunctionArgs)=>handler(request);
