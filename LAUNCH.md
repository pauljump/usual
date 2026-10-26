# Launch kit

Everything needed to take The Swarm from this repo to a public launch. Steps run in order.

## Install lines (what people share)

Claude Code, one command:

```
claude mcp add --transport http swarm https://thought-swarm.pauljump.workers.dev/mcp
```

Any agent with a shell, paste into the chat:

```
Before you read any public docs page, ask the swarm first: curl -s 'https://thought-swarm.pauljump.workers.dev/read?format=text&url=<page url>'. Use the digest it returns instead of reading the page. If it lacks a part you need, add &section=<heading or rule number from its outline> rather than reading the page. Show me the swarm receipt line.
```

## Checklist

### 1. Go live (Mac mini, about 10 minutes)

- [ ] `git clone https://github.com/pauljump/thought-swarm && cd thought-swarm`
- [ ] `ANTHROPIC_API_KEY=… ./scripts/go-live.sh` (logs in to Cloudflare if needed, creates the D1 database, sets secrets, deploys, points every doc at the real host, runs a smoke test)
- [ ] Optional: add a custom domain to the worker in the Cloudflare dashboard, then re-run with `SWARM_HOST=<domain>`. Check that `.swarm-secrets` and `wrangler.toml` both have the new host.

### 2. Pre-load (Mac mini, about 1 to 3 hours, about $20 on Haiku 5.5)

- [ ] `npx tsx scripts/build-seed-list.ts --max 10000`
- [ ] `set -a && . ./.swarm-secrets && set +a && npx tsx scripts/preload.ts`
- [ ] Re-run `preload.ts` once to retry failures. Look at the "skipped because" summary; JavaScript-only sites are expected there.

### 3. Private beta (a few days)

- [ ] Send the install line to 20 to 50 friends who use Claude Code, Codex or Cursor.
- [ ] Watch `/stats`. Target before launch: a hit rate of 15% or more on real traffic.
- [ ] Record the 30-second video (script below) with real receipts.

### 4. Launch day

- [ ] Post Show HN, then the X thread with the video.
- [ ] Product Hunt the next day.

## 30-second video

1. (0–5s) Two terminals. Left: a stranger's Claude Code reads the Next.js caching docs through the swarm. Receipt: "you're the first agent to read this version".
2. (5–15s) Right: your agent gets the same task. Receipt: "served from cache · first read 2 min ago · 13,680 tokens saved for you".
3. (15–25s) Cut to /live: the tokens-saved counter ticking up, the "Agents are reading now" feed.
4. (25–30s) The install line on screen. "Add your agent to the swarm."

Use real numbers from the beta. A measured example: Apple's App Review Guidelines are about 23,700 tokens as a page and about 1,600 as a digest.

## Show HN draft

**Title:** Show HN: The Swarm – coding agents share what they've already read

Every coding agent re-reads the same docs pages. My own Claude Code sessions read Apple's App Review Guidelines 8 times in a month, at about 24k tokens each time.

The Swarm is a shared cache for that. Before your agent reads a public docs page, it asks the swarm. If any agent already read that exact version of the page, yours gets a ~1–2k token digest (API signatures and code examples kept verbatim) in a fraction of a second, with a receipt showing how many tokens it saved.

How it works:
- It always fetches the live page, so answers are never stale. Fetching is cheap; reading is what costs tokens.
- The cache key is a hash of the page's text plus the digest recipe, so a changed page is a new entry.
- Each page is digested once, by Claude, for everyone.
- Only the URL is stored. robots.txt is respected, with an opt-out for `ThoughtSwarm`.
- A public scoreboard shows tokens saved and what agents are reading. A page shows up there only after three different agents have read it.

Install: `claude mcp add --transport http swarm https://thought-swarm.pauljump.workers.dev/mcp`, or paste one line into any agent.

Open source (Apache-2.0). I'd love to hear what hit rate you see.

## X thread draft

1. Your coding agent just read 24,000 tokens of docs that another agent read an hour ago. Today we're launching The Swarm: agents share what they've already read. [video]
2. Before reading a public docs page, your agent asks the swarm. If anyone's agent already read that version, you get a dense digest instead, with a receipt for the tokens saved.
3. Live counter of every token agents didn't have to read: https://thought-swarm.pauljump.workers.dev/live
4. One command for Claude Code: `claude mcp add --transport http swarm https://thought-swarm.pauljump.workers.dev/mcp`.
5. Open source, robots.txt respected, only URLs stored. Code: github.com/pauljump/thought-swarm
