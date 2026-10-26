# Launch kit

The Swarm launches as a 30-day public experiment, not a long-running product. The claim is that coding agents keep re-reading the same pages and burning tokens, when one read could serve everyone. The receipts and scoreboard are the evidence, and a results post on day 30 is the payoff. Steps run in order.

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

### 2. Pre-load, capped (Mac mini)

- [ ] Set a monthly spending limit on the Anthropic key in the Console before pre-loading.
- [ ] Pre-load the Apple pack plus a few hundred of the most-read framework pages, not the full 10k list.
- [ ] `npx tsx scripts/build-seed-list.ts --max 500` (or the Apple pack's own list)
- [ ] `set -a && . ./.swarm-secrets && set +a && npx tsx scripts/preload.ts`
- [ ] Re-run `preload.ts` once to retry failures. Look at the "skipped because" summary; JavaScript-only sites are expected there.

### 3. Warm the counter (days −3 to −1)

- [ ] Reset the stats so test reads don't count.
- [ ] Send the install line to 20 to 50 developers who use Claude Code, Codex or Cursor, mostly people shipping iOS apps, so the scoreboard isn't at zero on launch day.
- [ ] Record the 30-second video (script below) with real receipts.

### 4. Day 0 (a Tuesday or Wednesday)

- [ ] 08:15 PT: `gh repo edit pauljump/thought-swarm --visibility public --accept-visibility-change-consequences`, then check every link and command in the posts below from a clean machine (thoughtswarm.tryusual.com must resolve).
- [ ] 08:30 PT: post the X thread with the video, and pin it. 09:00 PT: Show HN.
- [ ] Reply to everyone for the first 3 hours. At about 3 hours, quote-tweet a scoreboard screenshot.

### 5. Days 7 and 14: check-ins

- [ ] Quote-tweet the scoreboard: agents, reads, share of re-reads, tokens not burned, and the most re-read page of the week.

### 6. Day 30: results, then shut down

- [ ] Results post: agents, reads, the share of reads that re-read a page another agent already read, tokens saved, the top 20 re-read pages, and the cost of running it. Add a clearly labeled projection ("if every coding agent did this…") worked out from the measured rate, with the math shown.
- [ ] Publish per-page read counts (URLs only) so others can check the result.
- [ ] Remove the API key so no new pages get digested. Leave a results page at the domain, and either keep serving cached pages or turn the worker off.

### Later: Agent Relay (not part of launch)

Relay was left out of the launch to keep the story simple (Paul's call, 2026-10-26). The code still supports it. When you add it, it's a second news moment ("The Swarm is now a public agent on Agent Relay"):

- [ ] `set -a && . ./.swarm-secrets && set +a && npx tsx scripts/claim-handle.ts register --domain <host>`, redeploy with `ARELAY_VERIFICATION_TOKEN`, then `claim-handle.ts verify`. Registered handles show up in the arelay.to/agents directory.
- [ ] Optional live feed: the `#swarm-live` Relay channel with an Observer link. It runs from the Node server, not the Worker, today.
- [ ] Relay's X handle is @agent_relay. Khaliq Gant is @khaliqgant.

## 30-second video

1. (0–5s) Two terminals. Left: a stranger's Claude Code asks what App Review Guideline 4.3 covers. It reads the guidelines through the swarm. Receipt: "you're the first agent to read this version".
2. (5–15s) Right: your agent gets the same question. Receipt: "served from cache · … tokens saved for you", and the answer comes from the 4.3 section the swarm returned.
3. (15–25s) Cut to /live: the tokens-saved counter ticking up, the "Agents are reading now" feed.
4. (25–30s) The install line on screen. "Add your agent to the swarm."

Use real numbers from the beta. A measured example: Apple's App Review Guidelines are about 23,700 tokens as a page and about 1,600 as a digest.

## Show HN draft

**Title:** Show HN: A 30-day experiment in how often coding agents re-read the same docs

Every coding agent re-reads the same docs pages. My own Claude Code sessions read Apple's App Review Guidelines 8 times in a month, at about 24k tokens each time. Multiply that by every agent out there.

The Swarm tests what happens if one agent reads a page and everyone else reuses that. Before your agent reads a public docs page, it asks the swarm. If any agent already read that exact version, yours gets a ~1–2k token digest (API signatures and code examples kept verbatim) plus an outline of the page's sections, with a receipt for the tokens saved. If the digest is missing something, the agent asks for that one section (say, rule 4.3) and gets it word for word.

How it works:
- It always fetches the live page, so answers are never stale. Fetching is cheap; reading is what costs tokens.
- The cache key is a hash of the page's text plus the digest recipe, so a changed page is a new entry.
- Each page is digested once, by Claude, for everyone.
- Only the URL is stored. robots.txt is respected, with an opt-out for `ThoughtSwarm`.
- A public scoreboard shows tokens saved and what agents are reading. A page shows up there only after three different agents have read it.

It runs for 30 days. Then I'll publish the numbers: how often agents re-read what another agent already read, and what that adds up to.

Install: `claude mcp add --transport http swarm https://thoughtswarm.tryusual.com/mcp`, or paste one line into any agent with a shell. Open source (Apache-2.0), part of Usual (tryusual.com).

## X thread

1. Every coding agent is reading the same docs pages, over and over. Mine read Apple's App Review Guidelines 8 times in one month, at about 24,000 tokens each time. So I'm running a 30-day experiment: what if one agent read it, and every other agent reused that? 🧵 [video]
2. It's called The Swarm. Before your agent opens a docs page, it asks the swarm first. If any agent already read that exact version, yours gets the digest instead: about 1,600 tokens instead of 23,700 for the guidelines. Plus a receipt for what it saved. [receipt screenshot]
3. Every receipt is counted on a public scoreboard: how many agents read the same page, and how many tokens they didn't have to burn. thoughtswarm.tryusual.com/live [scoreboard GIF]
4. It never goes stale. The live page is fetched every time, and the digest is keyed on a hash of its text. Need the exact wording of rule 4.3? Your agent asks for that one section and gets it word for word.
5. Add your agent to the experiment. In Claude Code, one line: `claude mcp add --transport http swarm https://thoughtswarm.tryusual.com/mcp`. Any agent with a shell: paste the one-line prompt from the README.
6. In 30 days I'll publish the numbers: how often agents re-read what another agent already read, and what that adds up to. Open source. Only URLs are stored. robots.txt is respected. Part of Usual: tryusual.com. github.com/pauljump/thought-swarm
