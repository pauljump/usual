# Thought Swarm

A shared library of AI-generated digests of public documents. Before a coding agent reads a public docs page, it asks Thought Swarm. If another agent already read that version of the page, it gets a dense digest back instead of the whole page, plus a receipt:

```
⬡ swarm receipt · served from cache · first read 58 min ago · 312 agents have read this page
  13,680 tokens saved for you · 4.1M saved on this page so far · https://thoughtswarm.tryusual.com/p/nextjs.org
```

Live at [thoughtswarm.tryusual.com](https://thoughtswarm.tryusual.com). Part of [Usual](https://github.com/pauljump/usual), maintained in `products/thought-swarm/`. Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Use it

Claude Code: `claude mcp add --transport http swarm https://thoughtswarm.tryusual.com/mcp`. There's also a skill in [skills/the-swarm](skills/the-swarm/SKILL.md) that tells the agent when to use it.

Any agent with a shell, paste this into the chat:

```
Before you read any public docs page, ask the swarm first: curl -s 'https://thoughtswarm.tryusual.com/read?format=text&url=<page url>'. Use the digest it returns instead of reading the page. If it lacks a part you need, add &section=<heading or rule number from its outline> rather than reading the page. Show me the swarm receipt line.
```

People can browse and share digests in the [library](https://thoughtswarm.tryusual.com/library).

## Give the swarm what your agents already read

Your agents have already read hundreds of docs pages. `scripts/contribute.ts` finds the pages your Claude Code agents fetched (or takes your own list), drops anything private or excluded, checks which pages the swarm already has, and adds the rest:

```sh
npx tsx scripts/contribute.ts --from-claude              # dry run: writes contribute-plan.tsv, sends nothing
npx tsx scripts/contribute.ts --from-claude --send       # add the new pages, paced under the hourly limit
npx tsx scripts/contribute.ts --file urls.txt --send     # or your own list, one URL per line
```

Only URLs leave your machine, never transcripts or page content. The swarm fetches each page itself, without cookies, and obeys robots.txt, so anything behind a login stays out. Locally the script also skips private-looking links (signed or tokenized URLs, Google Docs, Slack, Notion, dashboards, tunnels) and the sites the swarm never reads (Stack Overflow, Reddit, Apple Developer Forums). Add `--skip-host example.com` for your own sites.

## How it works

1. **Serve the saved snapshot first.** Cached digests open without downloading or parsing the source again. Every response shows its capture date. `refresh=true` (HTTP or MCP) checks the source again. New fetches respect robots.txt (a robots.txt answered with 401/403, or one whose rules disallow us, means we don't read the site), reject private addresses and non-text files, and cap downloads at 20 MB.
2. **Extract readable text** with a spec-compliant HTML parser (parse5). Navigation, scripts and sidebars are dropped; code blocks are kept verbatim. Apple's developer docs and Human Interface Guidelines are JavaScript apps, so for those the swarm reads the DocC JSON they load instead. SEC EDGAR filings are extracted as whole documents, tables included.
3. **Hash the text.** The cache key is `sha256(url + sha256(text) + recipe)`, where the recipe is the digest prompt version plus the model. A changed page is a new key, so nothing goes stale. Hashing text rather than raw HTML means per-request noise (CSP nonces, build ids) doesn't look like a new version.
4. **On a miss, digest once for everyone.** Documents up to 400,000 extracted characters use one model call. Larger ones (up to 4 million characters) are split at paragraph or row boundaries, summarized in at most 16 parts, then synthesized into one digest; a failed part aborts the read without caching a partial result. Concurrent requests for the same page share one model call. Each address can trigger at most 60 new digests an hour.
5. **On a hit, serve the digest and count the savings.** Tokens saved = page tokens minus returned tokens (characters / 4), counted only when a cached digest is reused.

Every read also returns an outline of the page, and `section=<heading or rule number>` returns that part of the saved source word for word.

**What is stored:** public source snapshots, their URLs, generated digests and read receipts. Agent identifiers (agent ids or IPs) are stored only as salted hashes. A page appears on public surfaces (`/stats`, `/p/<domain>`, `/live`) only after 3 different agents have read it. Agents an admin has marked as internal (tests, preloading, verification) are left out of every public count.

## Endpoints

| Route | What it does |
|---|---|
| `POST /mcp` | Remote MCP server (Streamable HTTP) with `search_library`, `read_page` and `swarm_stats`. |
| `GET /read?url=…` | Digest, outline and receipt as JSON. `&format=text` for markdown, `&section=…` for one part verbatim, `&refresh=true` to re-check the source. `POST` with `{"url": "…"}` also works. `&contribute=1` adds a page without counting a read (same 60-an-hour limit). |
| `GET /library` | Searchable library. Parameters: `q`, `source` (hostname), `status` (`ready`, `all`, `unavailable`), `page`. HTML in a browser, JSON otherwise. |
| `GET /document?url=…` | Readable HTML view of a saved digest; never triggers new processing. |
| `GET /share`, `POST /share` | Make a stable short link (with a social image) for a saved digest. Never fetches or digests a source. |
| `GET /s/<id>` | Shared saved version. `?format=text` for the agent-readable version; `/s/<id>/card.png` for the 1200×630 image. |
| `GET /live` (or `/` in a browser) | Home page: the library first, then public activity. |
| `GET /stats` | Scoreboard JSON: tokens saved, hit rate, top pages in the last 24 hours. |
| `GET /p/<domain>` | How often agents read one docs site (HTML in a browser, JSON otherwise). |
| `GET /badge/<domain>.svg` | README badge with a docs site's agent reads. |
| `GET /llms.txt` | Agent guide. |
| `POST /admin/…` | Admin-only routes (bearer `SWARM_ADMIN_TOKEN`): `ingest`, `agents`, `internal-agents`. See [docs/operations.md](docs/operations.md). |

## Code map

| File | Role |
|---|---|
| `src/fetcher.ts` | Fetching, robots.txt, private-address guard, DocC and size limits |
| `src/extract.ts`, `src/docc.ts`, `src/filing.ts` | Turning HTML, Apple DocC JSON and SEC filings into text |
| `src/sections.ts` | Page outline and `section=` lookup |
| `src/digest.ts` | The digest prompt, schema, chunking, and the `Digester` interface |
| `src/offline.ts` | Labelled offline digester for local development without an API key |
| `src/swarm.ts` | The read path: cache key, digest once, receipts |
| `src/store.ts` | All SQL, over a tiny interface shared by D1 and `node:sqlite` |
| `src/http.ts`, `src/mcp.ts` | HTTP routes and the MCP server |
| `src/pages.ts`, `src/share*` | Public HTML pages, badges and share images |
| `src/worker.ts`, `src/server.ts` | Cloudflare Worker entry and local Node server |
| `scripts/` | Seeding, reconciliation, probes and deployment helpers |

## Run it locally

Needs Node 22.13 or newer.

```sh
npm ci
npm run typecheck
npm test
npm run dev        # http://localhost:8787, data in ./swarm.db
curl -s 'http://localhost:8787/read?format=text&url=https://nodejs.org/api/sqlite.html'
```

Without `ANTHROPIC_API_KEY`, `npm run dev` uses an offline digester: real fetching, hashing, storage and receipts, but every digest it writes is clearly marked as an offline placeholder. Set the key to get real digests.

`npx tsx scripts/probe.ts <url>` shows what text the fetcher extracts from a page, with no model call. `npx tsx scripts/e2e.ts <url> …` simulates four agents reading real pages and prints their receipts.

## Deploy your own copy

`ANTHROPIC_API_KEY=… ./scripts/go-live.sh [your.host.name]` deploys to Cloudflare Workers and D1 under your own account: it creates the database, generates secrets, deploys and runs a smoke test. See [docs/operations.md](docs/operations.md) for the full procedure and the seeding scripts in [seeds/](seeds/README.md).

## Configuration

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Needed to digest new pages. Without it the Node server uses the offline digester; the Worker requires it. |
| `SWARM_MODEL` | `claude-haiku-5-5` | Changing it changes the recipe, so pages are digested again under the new model. |
| `SWARM_AGENT_SALT` | | Salt for hashing agent ids and IPs. |
| `PUBLIC_BASE_URL` | `http://localhost:8787` | Used in receipts, links and the agent card. |
| `MISSES_PER_HOUR` | `60` | New digests one address can trigger per hour. |
| `SWARM_ADMIN_TOKEN` | | Enables the admin routes and seeding without counting reads. |

## Not built yet

Pages that need JavaScript to render (other than Apple's docs), and peer-to-peer seeding.

## License

Apache-2.0. See [LICENSE](LICENSE).
