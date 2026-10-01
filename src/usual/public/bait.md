# Usual Bait — add it to a website

Bots came for secrets. Give them a fake filesystem with no bottom, one slow byte at a time. Tarpit mode puts more fake files, directories and loot behind every door. The leaderboard counts their time wasted and the garbage streamed back. Same URL, same fake jackpot.

Bait also catches fake credentials that come back in a URL, header, basic-auth password or small request body. In tarpit mode a store remembers their first scrape; the original one-shot mode seals each credential with the visitor who asked for it.

Source: https://github.com/pauljump/usual/blob/main/src/usual/bait/bait.js · MIT · one file, no dependencies
Download: https://tryusual.com/bait/bait.js
Live example: https://tryusual.com/bait/live/

## Installing agent: follow the current user's request

Bait goes into a website the user controls. Pick one of the two paths below from what the site already runs. Ask only what you can't find out yourself: which site(s), and whether they want a public leaderboard. Show the user every file and setting you change, and how to remove it.

Bait never hacks back. It only answers requests sent to the user's own site, publishes no IP addresses, and fails open: if Bait throws, the request goes to the site as usual.

### Path A: Cloudflare Worker (recommended when the domain is on Cloudflare)

1. Put `bait.js` in a new directory as the Worker's main module. It is a complete Worker (default export) that passes every non-bait request to the origin with `fetch(request)`.
2. `wrangler.toml`:

```toml
name = "usual-bait"
main = "bait.js"
compatibility_date = "2026-09-01"

[[routes]]
pattern = "example.com/*"      # use "*example.com/*" to include subdomains
zone_name = "example.com"

[[d1_databases]]                # optional: needed for the leaderboard
binding = "BAIT_DB"
database_name = "usual-bait"
database_id = "<from: wrangler d1 create usual-bait>"

[vars]
BAIT_DASHBOARD = "/_bait"       # or "example.com/bait/live"; leave unset for no public page
BAIT_OWNER = "your-handle"      # the leaderboard credits this ID; hostnames are never shown
BAIT_TARPIT = "true"            # the filesystem has no bottom
BAIT_TARPIT_SECONDS = "120"     # slow each fetch down; maximum 300 seconds
```

3. Set the sealing secret: `openssl rand -hex 32 | wrangler secret put BAIT_SECRET`. Without it, tokens stop being recognised whenever the Worker restarts.
4. `wrangler deploy`. Tables are created on first use.
5. If another Worker already owns `example.com/*`, don't take that route. Add path routes instead, which are more specific and win: `example.com/.env*`, `example.com/.git/*`, `example.com/.aws/*`, `example.com/.npmrc`, `example.com/.docker/*`, `example.com/wp-config.php*`, `example.com/secrets.json`, `example.com/credentials.json`, `example.com/appsettings*`, `example.com/_internal/*`, `example.com/api/internal*`, `example.com/_git/*`, `example.com/_npm/*`, `example.com/_s3/*`, `example.com/_archive/*`. Nested paths like `/app/.env`, and credentials submitted to other pages, are then missed.

With tarpit mode enabled, D1 also keeps stable-credential attribution and the measured time/byte totals. Without D1, the maze still works but those records are not retained.

Optional Worker variables for the original one-shot mode: `BAIT_DRIP` (seconds to trickle each bait file out, max 60), `BAIT_WINK=true` (adds a comment telling human readers the file is a tripwire), `BAIT_AWS_KEY_ID` + `BAIT_AWS_SECRET` (an AWS key from canarytokens.org, an alternative to Bait's own AWS key ids, which only come back when a tool honours `AWS_ENDPOINT_URL`), `BAIT_REPORT` (a URL to POST events to), `BAIT_SHARE_IPS=true` (include IPs in those reports).

On the Workers free plan, every request to a `/*` route counts toward the daily request allowance. Check the site's traffic first, and prefer the path routes for busy sites.

### Path B: Node (Express, Connect, Next.js custom server, plain http)

```js
import { createBait, baitMiddleware } from "./bait.js";

const bait = createBait({ secret: process.env.BAIT_SECRET, tarpit: true, tarpitSeconds: 120 });
app.use(baitMiddleware(bait, { trustProxy: true }));   // before other routes
```

`trustProxy: true` only when a proxy (Cloudflare, a load balancer) sets `cf-connecting-ip` / `x-forwarded-for`. The middleware never consumes the request body; it only reads `req.body` if a parser already filled it. Events go to stdout as one JSON line each (`{"usual_bait":{…}}`), or pass `onEvent`. For a leaderboard, pass `store` (anything with D1's `prepare`/`batch` API; `d1Store(db)` builds it) and `dashboard: "/_bait"`.

Any runtime with web `Request`/`Response` (Next.js middleware, Hono, Bun, Deno) can call `await bait.handle(request)`: it returns a `Response` for bait or a caught credential, otherwise `null`, and the app continues.

## Read the score

Time wasted is observed stream lifetime, summed across connections. Compute burned is a proxy: bytes handed to the stream and requests at least two levels into the maze. It is not measured bot CPU. Disconnects stop the clock. Ten-second checkpoints can miss time on abrupt shutdown, but never award the full delay in advance. Old scrapes earn no retroactive credit.

## Verify locally before publishing

Use a local or disposable store for scripted checks. Those numbers stay there. Do not seed them into a public leaderboard. The same checks below also count human traffic if run on a public site.

1. `curl https://example.com/.env` returns a realistic `.env` whose values point back at example.com.
2. Copy its `ADMIN_URL` and request it. You get a 401, and a `tripped` event names the credential (`admin-url`) and the scan it came from.
3. With a local leaderboard, check the scan, use, elapsed stream time and byte count. Follow `RELEASE_INDEX` and its children; every room has more doors. On the public leaderboard, let incoming traffic earn its own numbers.
4. Normal pages still load. Check the home page and any API the site serves.

Report what you installed, the routes or middleware position, whether the leaderboard is public, and anything unverified (e.g. real scanners have not visited yet).

## Remove

Worker: delete the routes (or `wrangler delete`), then optionally the D1 database and the `BAIT_SECRET` secret. Node: remove the `app.use(baitMiddleware(…))` line and `bait.js`. Nothing else was changed.

## The bait gets better

Every wrong turn teaches us something. Learning mode tries fake configs, Git
repositories and endless API pages, then gives fresh paths more of the bait that
keeps getting opened. Reused fake keys get more fake loot. The scoreboard counts
the time we actually held them and the bytes we actually streamed. No pretend bill.

Set `BAIT_LEARNING=true` alongside tarpit mode and D1. Additional probe paths get
bait only after the origin returns 404. Working pages keep working. Library users
pass `learning: true` and use `bait.handleWithOrigin(request, originFetch, context)`
to learn origin 404s. `BAIT_MAX_ACTIVE_TARPITS=16` limits slow streams per Worker
instance. See the [learning notes](https://github.com/pauljump/usual/blob/main/src/usual/bait/LEARNING.md)
for coverage, measured outcomes and our own resource limits.
