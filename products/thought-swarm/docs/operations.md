# Operations

How to deploy, seed and run a Thought Swarm instance, and what is left before the public launch. Contributors don't need any of this to work on the code; see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Deploy an instance

Cloudflare Workers + D1. The free plan is enough to serve saved digests; it stops serving rather than billing when a limit runs out. Very large first-time digests (big SEC filings) can exceed the free plan's CPU limit; prepare those with the reconciliation runner below instead.

```sh
ANTHROPIC_API_KEY=… ./scripts/go-live.sh [host]
```

The script installs dependencies, checks the Wrangler login (or `CLOUDFLARE_API_TOKEN`), creates the `thought-swarm` D1 database if `wrangler.toml` has no id yet, generates `SWARM_AGENT_SALT`, `SWARM_ADMIN_TOKEN` and `A2A_BEARER_TOKEN` into `.swarm-secrets` (mode 600, gitignored), deploys, sets the secrets and smoke-tests `/health`. With a `host` it points `PUBLIC_BASE_URL`, the docs and the skill at that hostname (`scripts/set-host.mjs`); add the custom-domain route in `wrangler.toml` yourself. Re-running it is safe.

The canonical instance is `thoughtswarm.tryusual.com` (Worker `thought-swarm`, with `thought-swarm.pauljump.workers.dev` kept as a fallback). Its credentials come from the maintainer's vault, never from files in this repository.

## Admin routes

All require `Authorization: Bearer $SWARM_ADMIN_TOKEN`.

| Route | Purpose |
|---|---|
| `GET /read?seed=1&url=…` | Digest a page without counting it as an agent read (used by `preload.ts`). |
| `POST /admin/ingest` | `{url, title, text, attribution?}`: digest text that was fetched and extracted elsewhere (used by `reconcile.ts` for pages too heavy to parse in the Worker). |
| `GET /admin/agents` | Agent hashes with read counts, first and last read, sample pages and whether each is marked internal. |
| `POST /admin/internal-agents` | `{agents: [hash…] \| agent_ids: [raw id or IP…], label, internal?: false}`: mark agents as internal (tests, verification, preloading) or unmark them. Internal agents stay in the raw `reads` table but are excluded from `/stats`, `/live`, `/p/<domain>`, badges and receipts. Nothing is deleted. |

## Seed a library

- `npx tsx scripts/build-seed-list.ts --max 500` builds `seeds/urls.txt` from `seeds/sites.tsv`.
- `SWARM_URL=… SWARM_ADMIN_TOKEN=… npx tsx scripts/preload.ts --concurrency 6` digests every URL through the deployed service. It is resumable via `seeds/done.txt`, but `done.txt` also lists skipped URLs, so it is not proof of completion.
- `scripts/reconcile.ts` is the authority: it checks every seed URL against D1, fetches and extracts missing pages locally (robots.txt respected), sends them to `/admin/ingest`, and records each URL's status in the `library` table and `seeds/reconciliation.json`. It needs `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, Cloudflare credentials and `SWARM_ADMIN_TOKEN` in the environment.

Current canonical library: 1,462 of 1,493 entries ready (the iOS and App Store submission pack plus Anthropic's S-1). The 31 unavailable ones are 30 Apple links that now return "Page Not Found" and Apple's JavaScript-only system status page. Per-URL results are in `seeds/reconciliation.json`.

## Costs

New digests use Claude Haiku 5.5 by default; a cache hit makes no model call. The 1,492-page submission pack was estimated at about $1 to $2. Put a monthly spending limit on the Anthropic key the Worker uses.

## Before the public launch

Decisions for Paul:

1. **Test reads.** The current counts include launch testing, reconciliation and verification reads, and early reads from an MCP bug where the digest didn't reach the agent. Recommended: mark those agents internal with `POST /admin/internal-agents` (reversible, nothing deleted) rather than deleting `reads`.
2. **Key cap.** Create a dedicated Anthropic key with a monthly limit, swap it into the Worker secret, and revoke any key that was ever pasted into a chat. Delete Cloudflare API tokens that were pasted into chats.
3. **Beta or straight to public.** A short beta with 20 to 50 iOS developers means real receipts and a non-zero scoreboard on launch day.

Already settled:

- The source is public in [pauljump/usual](https://github.com/pauljump/usual) under `products/thought-swarm/`. The old standalone repository is historical.
- The launch angle is iOS and App Store submission; the hostname is `thoughtswarm.tryusual.com`.
- Not read: Stack Overflow (robots.txt), Apple Developer Forums (human verification) and Reddit (robots.txt).
- Agent Relay is not part of the launch. The A2A endpoint and `scripts/claim-handle.ts` remain for a possible later announcement.

Post drafts are in [launch-posts.md](launch-posts.md). After the launch: check-ins on days 7 and 14, and a results post on day 30 with the measured re-read rate, tokens saved, top re-read pages and running cost, plus per-page read counts so others can check the result.
