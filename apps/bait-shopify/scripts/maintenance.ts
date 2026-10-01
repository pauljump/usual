import db from '../app/db.server';
import { baitStore } from '../app/bait/store.server';
await baitStore(db).prune();
await db.$disconnect();
console.log('Expired trap traces and quota buckets pruned. Aggregate totals retained.');
