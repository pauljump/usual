# The Swarm

The agent that has already read it. Coding agents ask The Swarm before they read a public docs page. If another agent already read that version of the page, they get a dense digest back instead of the whole page, plus a receipt:

```
⬡ swarm receipt · served from cache · first read 58 min ago · 312 agents have read this page
  13,680 tokens saved for you · 4.1M saved on this page so far · https://thoughtswarm.tryusual.com/p/nextjs.org
```

Part of [Usual](https://github.com/pauljump/usual), maintained in `products/thought-swarm/`. See [MIGRATION.md](MIGRATION.md) for preserved history and deployment details.

## How it works

1. **Serve the saved snapshot first.** Cached digests open without downloading or parsing the source again. Every response shows its capture date and explicitly says it was not checked live. Use `refresh=true` in HTTP or MCP to check the source again. New fetches respect robots.txt, reject private addresses and non-text files, and cap downloads at 20 MB.
2. **Extract readable text** with a spec-compliant HTML parser (parse5). Navigation, scripts and sidebars are dropped and code blocks are kept verbatim.
3. **Hash the text.** The cache key is `sha256(url + sha256(text) + recipe)`, where the recipe is the digest prompt version plus the model. A changed page is a new key, so nothing goes stale. Hashing the text rather than the raw HTML means per-request noise (CSP nonces, build ids) doesn't look like a new version.
4. **On a miss, digest once for everyone.** Documents up to 400,000 extracted characters use one call. Larger documents (up to 4 million characters) are split at paragraph/row boundaries, summarized sequentially in at most 16 parts, then synthesized into one cached digest. Every character is included; a failed part aborts the read without caching a partial result. Large-document digests disclose the synthesis, and may omit detail; source section lookup remains available. Claude writes a structured digest (summary, API signatures, verbatim code examples, gotchas). Concurrent requests for the same page share one model call. Each address can trigger at most 60 new digests an hour.
5. **On a hit, serve the digest and count the savings.** Tokens saved = page tokens minus digest tokens (chars / 4), counted only when a cached digest is reused.

SEC EDGAR filings are extracted as whole documents, preserving sibling pages and tables instead of selecting a single content block. Their uppercase section labels are included in the outline. On Cloudflare, the native streaming HTML parser keeps large filings out of a full JavaScript DOM; a Worker-runtime regression test covers this path. Saved reads work on Workers Free without reparsing large filings. Initial processing and explicit refresh of very large files may still exceed Free CPU limits; the reconciliation runner can prepare source snapshots outside the public read path. No plan upgrade is required to serve saved content.

Apple's developer docs and Human Interface Guidelines are JavaScript apps, so for those pages the swarm reads the DocC JSON they load instead of the HTML. A site whose robots.txt refuses the swarm (or answers 401/403 for it) is not read at all.

We store public source snapshots, their URLs, generated digests and read receipts. Agent identifiers derived from agent IDs or IPs are salted hashes; raw identifiers are not retained. A page appears on public surfaces (`/stats`, `/p/<domain>`, `/live`) only after 3 different agents have read it.

## Endpoints

| Route | What it does |
|---|---|
| `POST /mcp` | Remote MCP server (Streamable HTTP) with `search_library`, `read_page`, and `swarm_stats`. `claude mcp add --transport http swarm https://thoughtswarm.tryusual.com/mcp` |
| `GET /llms.txt` | Agent guide for discovery, reading, snapshots, sharing and interpreting statistics. |
| `GET /share` | Paste a saved document URL to get a short link and social preview. |
| `POST /share` | `{ "url": "original URL or Thought Swarm link" }` returns a stable saved-version URL and PNG URL; never fetches or digests a source. |
| `GET /s/<id>` | Shared saved-version page with Open Graph and X large-image metadata. Add `?format=text` for the same version with an agent receipt. |
| `GET /s/<id>/card.png` | Branded 1200×630 PNG; HEAD supported; cached at the edge for a day. |
| `GET /library` | Searchable curated library. Parameters: `q`, `source` (hostname), `status` (ready/all/unavailable), `page`. Defaults to ready-only, 24 entries per page; JSON includes total, page, page_size, source facets, and entries. |
| `GET /document?url=…` | Readable HTML view of a saved digest; never triggers fresh processing. |
| `GET /live` (or `/` in a browser) | The public scoreboard page. |
| `GET /badge/<domain>.svg` | README badge with how many agent reads a docs site has had. |
| `GET /read?url=…` | Digest, page outline and receipt as JSON. Add `&format=text` for markdown, which is what agents using curl want, and `&section=<heading or rule number>` for that part of the page word for word. `POST` with `{"url": "…", "section": "…"}` also works. |
| `GET /stats` | Scoreboard: tokens saved, hit rate, top pages in the last 24 hours, what agents are reading now. |
| `GET /p/<domain>` | How often agents read one docs site, and which pages (HTML in a browser, JSON otherwise). |

## Install

Claude Code: `claude mcp add --transport http swarm https://thoughtswarm.tryusual.com/mcp`. There's also a skill in [skills/the-swarm](skills/the-swarm/SKILL.md) that tells the agent when to use it.

Any agent with a shell:

```
Before you read any public docs page, ask the swarm first: curl -s 'https://thoughtswarm.tryusual.com/read?format=text&url=<page url>'. Use the digest it returns instead of reading the page. If it lacks a part you need, add &section=<heading or rule number from its outline> rather than reading the page. Show me the swarm receipt line.
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

## Deploy

`ANTHROPIC_API_KEY=… ./scripts/go-live.sh` deploys to Cloudflare Workers + D1: it logs in, creates the database, generates and sets secrets, deploys, and runs a smoke test. Then pre-load pages with the scripts in [seeds/](seeds/README.md). [LAUNCH.md](LAUNCH.md) has the full checklist and launch posts.

## Configuration

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Needed to digest new pages. |
| `SWARM_MODEL` | `claude-haiku-5-5` | Haiku keeps pre-loading cheap. Opus and Sonnet models also get server-side refusal fallbacks. Changing it changes the recipe, so pages are digested again under the new model. |
| `SWARM_AGENT_SALT` | | Salt for hashing agent ids and IPs. |
| `PUBLIC_BASE_URL` | `http://localhost:8787` | Used in receipts and the agent card. |
| `MISSES_PER_HOUR` | `60` | New digests one address can trigger per hour. |
| `SWARM_ADMIN_TOKEN` | | Lets `scripts/preload.ts` seed pages without counting them as agent reads. |

## Not built yet

Pages that need JavaScript to render (other than Apple's docs), and peer-to-peer seeding.

## License

Apache-2.0

## Reconcile the curated library

`scripts/reconcile.ts` checks every seed URL against D1, reuses completed digests across recipes, and extracts sources and checks robots.txt on the Mini, then uses the admin-authenticated `/admin/ingest` Worker endpoint (Anthropic) for missing digests. Runtime credentials must be supplied from the vault. It records each URL in `library` and `seeds/reconciliation.json`; missing pages and source restrictions remain explicit, never silently counted as complete. Source snapshots are published only after all chunks are stored. The older `done.txt` is not an authority for completion because it included skipped URLs.

## Social sharing

Every saved document offers Copy share link, Share on X (opens a draft), Download image, and a preview. `/share` accepts the original source URL, a `/document?url=...` link, or an existing short link. Unsaved documents show a library-directed error; sharing never starts a model call. Short IDs use a 16-character digest-key prefix; ambiguous prefixes return 404 and link generation falls back to the complete key. Links pin the digest version, including its agent-readable response. Human document views, share generation, and crawler image requests do not add agent reads; explicit agent-readable requests do.

Social images are generated locally within the Worker using pre-rendered raster glyphs and native PNG compression, with no external image service or extra runtime dependencies. The raster alphabet supports Latin-1 and common typographic punctuation; unsupported glyphs use `?` in the image only (full Unicode titles remain intact in HTML and metadata). Long titles wrap and truncate in the image. `scripts/build-share-font.py` regenerates the committed glyph data on macOS with Pillow. X/Open Graph metadata is server rendered; actual display and refresh timing remain controlled by the social platform.

The share feature is published and verified on thoughtswarm.tryusual.com. It uses the existing canonical Worker/domain and does not require any new provider or model credentials.

The homepage explains the product for people and agents, offers library search and agent setup, then shows usage grouped by document rather than a repeated request stream. Document titles appear alongside source URLs, and requests and estimated token savings are explained. Distinct agent identifiers are not verified unique people.

The homepage and library are collection-agnostic: no hard-coded featured filings or packs. Library search is server-side with bounded output, source and availability filters, and pagination. Search covers titles, collection names, and URLs rather than full text. The new layout and agent guide are published and verified on thoughtswarm.tryusual.com.

Published 2026-10-26: Worker version `f174ac24-f747-4bbb-ae02-0823e9c1cf42`. Validation: 73 tests, typecheck, live homepage, library search, MCP search, agent guide, and the S-1 short link with its 1200×630 PNG and social metadata. No new model processing was used for deployment verification.
