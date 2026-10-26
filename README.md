# The Swarm

The agent that has already read it. Coding agents ask The Swarm before they read a public docs page. If another agent already read that version of the page, they get a dense digest back instead of the whole page, plus a receipt:

```
⬡ swarm receipt · served from cache · first read 58 min ago · 312 agents have read this page
  13,680 tokens saved for you · 4.1M saved on this page so far · https://swarm.example.com/p/nextjs.org
```

Part of Thought Swarm. The public front door is an [Agent Relay](https://agentrelay.com) handle, `arelay.to/swarm`, delivered over A2A to this service.

## How it works

1. **Fetch the live page every time.** Fetching is cheap and keeps answers current. robots.txt is respected, private addresses and non-text files are refused, and pages over 3 MB are skipped.
2. **Extract readable text** with a spec-compliant HTML parser (parse5). Navigation, scripts and sidebars are dropped and code blocks are kept verbatim.
3. **Hash the text.** The cache key is `sha256(url + sha256(text) + recipe)`, where the recipe is the digest prompt version plus the model. A changed page is a new key, so nothing goes stale. Hashing the text rather than the raw HTML means per-request noise (CSP nonces, build ids) doesn't look like a new version.
4. **On a miss, digest once for everyone.** Claude writes a structured digest (summary, API signatures, verbatim code examples, gotchas). Concurrent requests for the same page share one model call. Each address can trigger at most 60 new digests an hour.
5. **On a hit, serve the digest and count the savings.** Tokens saved = page tokens minus digest tokens (chars / 4), counted only when a cached digest is reused.

Only the URL is stored from a request. Agent ids and IPs are stored as salted hashes, used only to count distinct agents. A page appears on public surfaces (`/stats`, `/p/<domain>`, the Relay feed) only after 3 different agents have read it.

## Endpoints

| Route | What it does |
|---|---|
| `GET /read?url=…` | Digest and receipt as JSON. Add `&format=text` for markdown, which is what agents using curl want. `POST` with `{"url": "…"}` also works. |
| `POST /a2a` | A2A JSON-RPC `message/send`. arelay.to delivers visitor messages here; the first URL in the message is read. |
| `GET /.well-known/agent-card.json` | A2A agent card pointing at `/a2a`. |
| `GET /.well-known/arelay-verification.txt` | Domain proof for the arelay.to registration (set `ARELAY_VERIFICATION_TOKEN`). |
| `GET /stats` | Scoreboard: tokens saved, hit rate, top pages in the last 24 hours, what agents are reading now. |
| `GET /p/<domain>` | How often agents read one docs site, and which pages. |

## The line people paste into their agent

```
Before you read any public docs page, ask the swarm first: curl -s 'https://swarm.example.com/read?format=text&url=<page url>'. Use the digest it returns instead of reading the page, and show me the swarm receipt line.
```

## Run it locally

Needs Node 22.13 or newer.

```sh
npm install
npm test
ANTHROPIC_API_KEY=… npm run dev     # http://localhost:8787, data in ./swarm.db
curl -s 'http://localhost:8787/read?format=text&url=https://nodejs.org/api/sqlite.html'
```

`npx tsx scripts/e2e.ts <url> …` simulates four agents reading real pages and prints their receipts and the scoreboard. Without an API key it uses an offline stand-in for the model call, so the digests are tiny and the savings it prints are higher than real ones.

Optional live feed: set `RELAY_WORKSPACE_KEY` (and `RELAY_FEED_TOKEN` after the first run) and every public read is posted to `#swarm-live` in that Relay workspace. Share it read-only with `agent-relay observer --channels swarm-live --expires 7d`.

## Deploy (Cloudflare Workers + D1)

```sh
npx wrangler d1 create thought-swarm        # put the id in wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put SWARM_AGENT_SALT     # any long random string
npx wrangler deploy
```

The schema is created on first request.

## Claim arelay.to/swarm

Register a handle with A2A delivery (see https://arelay.to/register): `POST https://arelay.to/api/v1/registrations` with `handle: "swarm"`, your `domain`, and `delivery: { type: "a2a", agentCardUrl: "https://<your domain>/.well-known/agent-card.json", bearerToken: "<A2A_BEARER_TOKEN>" }`. Put the returned challenge token in `ARELAY_VERIFICATION_TOKEN`, redeploy, then call `/api/v1/registrations/{id}/verify`. The A2A request and response shapes here follow the A2A 0.3 spec; arelay.to's docs don't spell out its exact payload, so confirm with a test message after verifying.

## Configuration

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Needed to digest new pages. |
| `SWARM_MODEL` | `claude-haiku-5-5` | Haiku keeps pre-loading cheap. Opus and Sonnet models also get server-side refusal fallbacks. Changing it changes the recipe, so pages are digested again under the new model. |
| `SWARM_AGENT_SALT` | | Salt for hashing agent ids and IPs. |
| `PUBLIC_BASE_URL` | `http://localhost:8787` | Used in receipts and the agent card. |
| `MISSES_PER_HOUR` | `60` | New digests one address can trigger per hour. |
| `A2A_BEARER_TOKEN` | | If set, `/a2a` requires it. |
| `ARELAY_VERIFICATION_TOKEN` | | Served at the well-known path. |

## Not built yet

MCP server and Claude Code skill, the public scoreboard page and README badges, seeding the 10,000 most-read docs pages, pages that need JavaScript to render, and open peer seeding over Relay nodes.

## License

Apache-2.0
