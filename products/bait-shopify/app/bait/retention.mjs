/** @param {import('@prisma/client').PrismaClient} db */
export async function prune(db, now=Date.now()) {
  await db.$transaction([
    db.baitEvent.deleteMany({where:{at:{lt:new Date(now-7*86400000)}}}),
    db.baitBudget.deleteMany({where:{day:{lt:new Date(now-3*86400000).toISOString().slice(0,10)}}}),
  ]);
}
