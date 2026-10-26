# Launch plan

The Swarm launches as a 30-day public experiment, a proof of concept rather than a long-running product. The claim: coding agents keep re-reading the same docs pages and burning tokens, when one read could serve everyone. The receipts and the scoreboard are the evidence, and a results post on day 30 is the payoff.

This is the one checklist for the launch, reconciled across every thread on 26 Oct. Each item is marked **done**, **in progress**, **waiting on Paul** or **to do**.

## Decisions so far (26 Oct)

- **Angle:** iOS and App Store submission. Agents read Apple's guidelines and docs constantly; Paul's agents read the App Review Guidelines 8 times in a month.
- **Home:** thoughtswarm.tryusual.com, styled as a tool on the Usual menu. thought-swarm.pauljump.workers.dev stays up as a fallback.
- **Agent Relay is out of this launch.** No arelay.to handle, no founders note, no Relay mentions. The code stays for a possible later post (see the end).
- **Pre-load:** the iOS submission pack only (1,492 pages, about $1–2 on Haiku 5.5). The generic 8,790-page framework list is on hold.
- **Not included:** Stack Overflow (its robots.txt says no crawlers and no AI use), Apple's Developer Forums (human check) and Reddit (robots.txt).
- **Costs stay small:** Cloudflare's free plan, which stops serving rather than billing when its limits run out, and a spending cap on the Anthropic key. No extra infrastructure.

## Open decisions for Paul

1. **Friends beta first, or straight to public?** A short beta (20 to 50 iOS developers for 2 or 3 days) means the scoreboard isn't at zero on launch day, and it gives real receipts for the video. Going straight to public is faster, but the first hours would show near-zero numbers. Recommended: the short beta.
2. **Spending cap on the Anthropic key.** Recommended: in the Console, create a new key for The Swarm with a $25 monthly limit, swap it in, and revoke the key that was pasted in chat. That's the cap and the rotation in one step.

## Install lines (what people share)

Claude Code, one command:

```
claude mcp add --transport http swarm https://thoughtswarm.tryusual.com/mcp
```

Any agent with a shell, paste into the chat:

```
Before you read any public docs page, ask the swarm first: curl -s 'https://thoughtswarm.tryusual.com/read?format=text&url=<page url>'. Use the digest it returns instead of reading the page. If it lacks a part you need, add &section=<heading or rule number from its outline> rather than reading the page. Show me the swarm receipt line.
```

## Checklist

### 1. Build and deploy

- **done** Live on Cloudflare Workers + D1, 54 tests passing.
- **done** Claude Code fix: `read_page` returns the digest as text, so agents use it instead of re-reading the page. Agents are counted per address, not per session.
- **done** Apple's JavaScript-built docs (developer.apple.com/documentation and the HIG) are read through their JSON.
- **done** Section lookup: every answer has an outline, and `section=4.3` returns that part of the live page word for word.
- **done** robots.txt is respected, including when a site serves it with an error status. Stack Overflow is refused.
- **done** Agent Relay removed from the README, this file and the usage text.
- **in progress** Switch on thoughtswarm.tryusual.com (Paul said go at 12:38Z).
- **waiting on Paul** Merge the Usual restyle, [PR #2](https://github.com/pauljump/thought-swarm/pull/2) (rebased, 54 tests pass), then redeploy from the Mini.
- **to do** Re-run the stranger test on the live domain once it resolves: a clean Claude Code install answering what App Review Guideline 4.3 covers, the curl paste line, /live and the badges.

### 2. Pre-load and costs

- **done** iOS submission pack built, 1,492 pages: App Store Connect, developer account and App Review help; the App Review Guidelines; the HIG; StoreKit, privacy and ATT, Sign in with Apple, Xcode distribution, TestFlight and Xcode Cloud; the EU rules; Apple developer news; 69 WWDC sessions; plus fastlane, Expo, RevenueCat, Flutter, Capacitor and React Native.
- **in progress** Pre-load the pack (Paul said go at 12:38Z). Re-run `preload.ts` once afterwards to retry failures.
- **waiting on Paul** Spending cap and key swap (open decision 2). Also delete the Cloudflare API token that was pasted in chat once the domain is live.
- **to do** Reset the stats so test reads don't count: `npx wrangler d1 execute DB --remote --command "DELETE FROM reads"`. Cached digests stay.

### 3. Warm the counter (days −3 to −1, if Paul picks the beta)

- **to do** Send the install line to 20 to 50 developers who ship iOS apps with Claude Code, Codex or Cursor.
- **to do** Record the video, receipt screenshot and scoreboard GIF from real receipts (script below).

### 4. Day 0 (a Tuesday or Wednesday)

- **to do** Before the repo goes public: drop "on Agent Relay" from the GitHub repo description with `gh repo edit pauljump/thought-swarm --description "The Swarm: coding agents share what they've already read. A 30-day experiment in how often agents re-read the same docs. Part of Usual (tryusual.com)."`
- **to do** 08:15 PT: `gh repo edit pauljump/thought-swarm --visibility public --accept-visibility-change-consequences`, then check every link and command in the posts from a clean machine.
- **to do** 08:30 PT: post the X thread with the video, and pin it. 09:00 PT: Show HN.
- **to do** Reply to everyone for the first 3 hours. At about 3 hours, quote-tweet a scoreboard screenshot.

### 5. Days 7 and 14: check-ins

- **to do** Quote-tweet the scoreboard: agents, reads, the share that were re-reads, tokens not burned, and the most re-read page of the week.

### 6. Day 30: results, then shut down

- **to do** Results post: agents, reads, the share of reads that re-read a page another agent already read, tokens saved, the top 20 re-read pages and the cost of running it. Add a clearly labeled projection ("if every coding agent did this…") worked out from the measured rate, with the math shown.
- **to do** Publish per-page read counts (URLs only) so others can check the result.
- **to do** Remove the API key so no new pages get digested. Leave a results page at the domain, and either keep serving cached pages or turn the Worker off (Paul's call).

### Reference: pre-loading another list

`preload.ts` reads `seeds/urls.txt`, skips what's already in `seeds/done.txt`, and prints a "skipped because" summary at the end: `set -a && . ./.swarm-secrets && set +a && npx tsx scripts/preload.ts`. `npx tsx scripts/build-seed-list.ts --max 500` builds a framework list from `seeds/sites.tsv`. First-time setup on a new machine is `ANTHROPIC_API_KEY=… ./scripts/go-live.sh`.

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

## Later: Agent Relay (not part of launch)

Relay was left out of the launch to keep the story simple (Paul's call, 2026-10-26). The code still supports it. When you add it, it's a second news moment ("The Swarm is now a public agent on Agent Relay"):

- [ ] `set -a && . ./.swarm-secrets && set +a && npx tsx scripts/claim-handle.ts register --domain <host>`, redeploy with `ARELAY_VERIFICATION_TOKEN`, then `claim-handle.ts verify`. Registered handles show up in the arelay.to/agents directory.
- [ ] Optional live feed: the `#swarm-live` Relay channel with an Observer link. It runs from the Node server, not the Worker, today.
- [ ] Relay's X handle is @agent_relay. Khaliq Gant is @khaliqgant.
