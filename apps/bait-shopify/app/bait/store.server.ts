import {prune} from './retention.mjs';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { RECIPE, type Generated } from './catalog.server';
export const SHOP_DAILY_CAP = 2000;
export const GLOBAL_DAILY_CAP = 20000;
export const TRACE_CAP = 200;
import {CONSENT_VERSION} from './contract';
class BudgetReached extends Error {}
class Inactive extends Error {}
export function baitStore(db: PrismaClient, nowMs = Date.now) {
  const day = () => new Date(nowMs()).toISOString().slice(0,10);
  return {
    async initialize(shop: string) {
      return db.baitShop.upsert({where:{shop}, update:{}, create:{shop,secret:randomBytes(32).toString('hex')}});
    },
    async settings(shop: string) { return db.baitShop.findUnique({where:{shop}}); },
    async enable(shop: string, enabled: boolean) {
      return db.baitShop.update({where:{shop},data:{enabled,...(enabled ? {consentAt:new Date(nowMs()),consentVersion:CONSENT_VERSION}: {})}});
    },
    async record(shop: string, secret: string, output: Generated, client: string): Promise<'recorded'|'budget'|'inactive'> {
      try {
        await db.$transaction(async tx => {
          for (const [scope, cap] of [[shop,SHOP_DAILY_CAP],['global',GLOBAL_DAILY_CAP]] as const) {
            const id = `${scope}:${day()}`;
            await tx.baitBudget.upsert({where:{id},create:{id,day:day()},update:{}});
            const result=await tx.baitBudget.updateMany({where:{id,requests:{lt:cap}},data:{requests:{increment:1}}});
            if (!result.count) throw new BudgetReached();
          }
          const changed = await tx.baitShop.updateMany({where:{shop,enabled:true,secret},data:{
            requests:{increment:1},records:{increment:output.records},bytes:{increment:BigInt(output.bytes)},
            deepRequests:{increment:output.depth>=2?1:0},lastRecordedAt:new Date(nowMs())}});
          if (!changed.count) throw new Inactive();
          await tx.baitShop.updateMany({where:{shop,deepest:{lt:output.depth}},data:{deepest:output.depth}});
          const count=await tx.baitShop.findUniqueOrThrow({where:{shop},select:{requests:true}});
          const event={shop,slot:count.requests%TRACE_CAP,at:new Date(nowMs()),journey:output.journey,kind:output.kind,
            depth:output.depth,records:output.records,bytes:output.bytes,client,version:RECIPE};
          await tx.baitEvent.upsert({where:{shop_slot:{shop,slot:event.slot}},create:event,update:event});
        });
        return 'recorded';
      } catch(e) {
        if (e instanceof BudgetReached) return 'budget';
        if (e instanceof Inactive) return 'inactive';
        throw e;
      }
    },
    async score(shop: string) {
      const [config,events,today] = await Promise.all([
        db.baitShop.findUniqueOrThrow({where:{shop}}),
        db.baitEvent.findMany({where:{shop,at:{gte:new Date(nowMs()-7*86400000)}},orderBy:{at:'desc'},take:20,
          select:{at:true,journey:true,kind:true,depth:true,records:true,bytes:true,client:true,version:true}}),
        db.baitBudget.findUnique({where:{id:`${shop}:${day()}`}}),
      ]);
      return { enabled:config.enabled, since:config.createdAt.toISOString(), generatedAt:new Date(nowMs()).toISOString(),
        lastRecordedAt:config.lastRecordedAt?.toISOString()||null, requests:config.requests, records:config.records,
        bytes:config.bytes.toString(), deepRequests:config.deepRequests, deepest:config.deepest,
        today:today?.requests||0, dailyCap:SHOP_DAILY_CAP, sharing:false as const,
        recent:events.map(e=>({...e,at:e.at.toISOString()})),
        measurement:'Accepted GETs to our decoy endpoints and bytes generated before response delivery. Humans and retries can count. Not unique bots, verified downloads, bot CPU or time wasted.',
      };
    },
    async erase(shop: string) {
      await db.$transaction([
        db.baitEvent.deleteMany({where:{shop}}),db.baitShop.deleteMany({where:{shop}}),
        db.baitBudget.deleteMany({where:{id:{startsWith:`${shop}:`}}}),db.session.deleteMany({where:{shop}}),
      ]);
    },
    async prune() { await prune(db,nowMs()); },
  };
}
export type Score = Awaited<ReturnType<ReturnType<typeof baitStore>['score']>>;
