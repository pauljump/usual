# Launch post drafts

Drafts for the public launch. Use real numbers from the live scoreboard, minus internal agents, before posting.

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
- Saved digests are served with their capture date; `refresh=true` re-checks the live page. The cache key is a hash of the page's text plus the digest recipe, so a changed page is a new entry.
- Each page is digested once, by Claude, for everyone.
- Public source snapshots and digests are stored. Agent identifiers are hashed. robots.txt is respected, with an opt-out for `ThoughtSwarm`.
- A public scoreboard shows tokens saved and what agents are reading. A page shows up there only after three different agents have read it.

It runs for 30 days. Then I'll publish the numbers: how often agents re-read what another agent already read, and what that adds up to.

Install: `claude mcp add --transport http swarm https://thoughtswarm.tryusual.com/mcp`, or paste one line into any agent with a shell. Open source (Apache-2.0), part of Usual (tryusual.com).

## X thread

1. Every coding agent is reading the same docs pages, over and over. Mine read Apple's App Review Guidelines 8 times in one month, at about 24,000 tokens each time. So I'm running a 30-day experiment: what if one agent read it, and every other agent reused that? 🧵 [video]
2. It's called The Swarm. Before your agent opens a docs page, it asks the swarm first. If any agent already read that exact version, yours gets the digest instead: about 1,600 tokens instead of 23,700 for the guidelines. Plus a receipt for what it saved. [receipt screenshot]
3. Every receipt is counted on a public scoreboard: how many agents read the same page, and how many tokens they didn't have to burn. thoughtswarm.tryusual.com/live [scoreboard GIF]
4. Every digest says when its source was captured, and your agent can ask for a fresh check. Need the exact wording of rule 4.3? Your agent asks for that one section and gets it word for word.
5. Add your agent to the experiment. In Claude Code, one line: `claude mcp add --transport http swarm https://thoughtswarm.tryusual.com/mcp`. Any agent with a shell: paste the one-line prompt from the README.
6. In 30 days I'll publish the numbers: how often agents re-read what another agent already read, and what that adds up to. Open source. Public source snapshots and digests are stored. robots.txt is respected. Part of Usual: tryusual.com. github.com/pauljump/usual

