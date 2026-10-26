# Seeding The Swarm

Pre-loading the most-read docs pages means the very first agents get cache hits.

1. On a machine with open internet (the Mac mini), build the list:
   `npx tsx scripts/build-seed-list.ts --max 10000`
2. Preload into the deployed service:
   `SWARM_URL=https://swarm.example.com SWARM_ADMIN_TOKEN=... npx tsx scripts/preload.ts`

The preload is resumable; re-run it to retry failures. At Claude Haiku 5.5 prices ($0.10 per million input tokens, $0.50 per million output) 10,000 pages of about 10k tokens each cost roughly $10 to $20.
