# Contributing to Thought Swarm

Thought Swarm lives in the [Usual](https://github.com/pauljump/usual) repository under `products/thought-swarm/`. Issues and pull requests go to that repository; Usual's general rules are in its [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Set up

Node 22.13 or newer. No accounts or keys are needed to work on the code.

```sh
git clone https://github.com/pauljump/usual
cd usual/products/thought-swarm
npm ci
npm run typecheck
npm test
npm run dev        # http://localhost:8787, SQLite at ./swarm.db
```

Without `ANTHROPIC_API_KEY`, `npm run dev` uses the offline digester in `src/offline.ts`. Fetching, extraction, hashing, storage, receipts and the pages are all real; only the model call is replaced, and every digest it writes says `OFFLINE PLACEHOLDER` in its title, summary and gotchas. Offline digests use their own recipe, so they never share a cache key with real ones. Delete `swarm.db` to start over.

Useful while working:

- `npx tsx scripts/probe.ts <url>`: what text the fetcher extracts from a page, and whether it is stable across two fetches. No model call.
- `npx tsx scripts/e2e.ts <url> …`: four simulated agents read real pages through the full stack.
- `npx vitest run test/<file>.test.ts`: one test file.

The [code map](README.md#code-map) in the README says where things live. The read path is `fetcher.ts` → `extract.ts` → `swarm.ts` (cache key, digest once) → `store.ts` → `http.ts` / `mcp.ts`.

## What a good change looks like

- **Tests.** Tests run against fake web pages (`test/helpers.ts`) and an in-memory SQLite database, never the network or a model. Add one for every behaviour change. Worker-specific paths have Miniflare tests (`*-worker.test.ts`).
- **Both runtimes.** `store.ts` SQL must run on Cloudflare D1 and on `node:sqlite`. Schema changes are additive (`CREATE TABLE IF NOT EXISTS`), because `init()` runs on every cold start against the live database.
- **Recipes.** If you change the digest prompt or schema, bump `RECIPE_VERSION` in `src/digest.ts`, so old digests are never served under a new recipe.
- **Respect sources.** Never work around robots.txt, bot checks or rate limits. A site that refuses us is not read.
- **Honest numbers.** Public counts must be real agent reads. Preloading, ingestion, browser views, previews and agents marked internal never count. Don't add simulated or test traffic to public surfaces.
- **Privacy.** Store only what the README says is stored. Agent ids and IPs are salted hashes; never log or store raw ones.
- **No secrets in the repository.** Keys and tokens come from the environment (`wrangler secret put` in production). `.swarm-secrets`, `.dev.vars` and databases are gitignored.

## Deploying

You don't need to deploy to contribute. To run your own instance, see [docs/operations.md](docs/operations.md). The canonical instance at thoughtswarm.tryusual.com is deployed by the maintainer.
