# Claude handoff — Usual and Thought Swarm

Updated 26 October 2026. This is continuation context, not authorization to publish,
spend, or invoke provider APIs. Follow the root AGENTS.md and Paul's current request.

## Canonical source and decisions

- All Usual-owned products belong in `pauljump/usual`, local root
  `/Users/mini-home/projects/usual/core`. See `products/README.md` and
  `products/registry.json` (14 products).
- Independent packages use `products/<slug>/`; shared Python implementations remain
  under `src/usual/`, linked from their product READMEs.
- Thought Swarm: `products/thought-swarm/`. Its entire standalone Git history was
  imported, including six formerly unpublished commits. Escape history was imported too.
- Usual Keyboard reusable source is in `products/keyboard/`. Private message fixtures,
  vocabulary seeds and original private Git history were NOT imported. Originals remain
  under `usual/history/`. Old project paths are compatibility symlinks.
- Bait for Shopify moved to `products/bait-shopify/`; `apps/bait-shopify` is a compatibility link.
- The Usual workshop formerly called Turrii is **Proof**, with product notes in
  `products/proof/` and implementation `src/usual/proof_jam.py`. Legacy `/turrii`
  routes redirect to `/proof` in source; old vault variable names and archive paths
  remain supported. Existing saved conversations are not rewritten. This session did
  not restart usual-web or verify the live Proof route; do not claim that route is deployed.
- **Leave the Verhum keyboard entirely out of Usual.** Paul explicitly resolved the
  ambiguity: keep it in `Verhum/paul`, unchanged. Its current checkout has unrelated
  work in progress; do not modify it as part of this consolidation.
- External Turrii research attribution stays accurate; it is not renamed to Proof.

## Published and live

Paul explicitly approved GitHub changes. The consolidation and Thought Swarm star
button were pushed to `pauljump/usual/main` through commit `773fb39`.

- Product directory: https://github.com/pauljump/usual/tree/main/products
- Thought Swarm: https://thoughtswarm.tryusual.com/
- Library: https://thoughtswarm.tryusual.com/library
- Apple documents: https://thoughtswarm.tryusual.com/library?source=developer.apple.com
- S-1 stable share link: https://thoughtswarm.tryusual.com/s/648eda74f7f99f4f
- S-1 social image: https://thoughtswarm.tryusual.com/s/648eda74f7f99f4f/card.png
- GitHub button targets https://github.com/pauljump/usual and displays its current
  stars via `/github-stars`. Last verified: 16. Metadata is cached for an hour;
  failures preserve the last real count or leave the count absent, never invent it.
- Worker deployment: `cacc2bab-b164-4580-8777-bd40aefa2f50`. Worker `thought-swarm`,
  existing custom domain and D1 database are unchanged. No model calls were used for
  the migration, counter or homepage work.

## Homepage commit still needs GitHub publication approval

`b4a1bf6` condenses tryusual.com and highlights Thought Swarm with direct Apple/S-1
links, a compact tool grid, and the existing walkthrough behind a disclosure.
The homepage is LIVE because usual-web reads the source HTML/CSS on each request.
Desktop and mobile views were verified. Screenshot:
`/Users/mini-home/projects/output/usual-home-condensed.png`.

The GitHub push for this new homepage commit was rejected by automatic approval
review, which required explicit approval for this new publication. Paul has not
subsequently approved it. Do not bypass that rejection or claim GitHub has this
homepage commit. This handoff commit will also be local until approved for push.

## What still confused Paul — unresolved product work

Thought Swarm's activity leaderboard is not its document library. Paul expected
Apple docs to appear there and did not recognize Node.js. Investigation confirmed:

- Node.js URL documentation came from Claude launch-verification requests on
  October 26, not Paul deliberately adding it. Recall session:
  `0ba6ef9be724c230b07fd3c9dd41aa425123ecf429709c1885834f323b20d2aa`.
- That verifier reported an early MCP response bug: Claude did not receive the
  digest and fetched the original instead, so displayed savings were not actual
  avoided downstream reading. The response bug was subsequently fixed, but those
  test reads remain in the public counts.
- Live library check found 960 ready documents on developer.apple.com; the broader
  submission pack includes other hosts. Last reconciliation: 1,462 ready entries
  overall, including the S-1; 31 unavailable. Do not call all 1,461 other entries
  Apple-hosted documents.
- Preloading does not count as reading. The activity list requires three distinct
  hashed identifiers. These are not unique people and can include testing.
- The S-1's 12 requests include at least five Codex processing/verification requests.
  The remaining requests cannot be confidently attributed from stored salted hashes.
- Suggested next UX work: foreground available documents/collections on Thought
  Swarm, make activity secondary, and separate test activity from public usage.
  This has NOT been implemented. Do not delete or reset historical reads without
  authorization, or silently describe test counts as organic adoption.

## Storage and processing facts

“Only URLs are stored” is inaccurate. Public source snapshots, URLs, digests and
read receipts are stored; agent identifiers are salted hashes. robots.txt is
respected. Older snapshots may lack exact source text.

The Apple reconciliation and S-1 processing are complete to their recorded statuses.
Saved digests open without fetching/parsing the source again, which fixed the
large-filing Worker CPU failure. Explicit refresh/new processing can use Anthropic
and must follow current-turn spend authorization. Credentials stay in the vault.
Do not invoke `/read` for new content merely to verify deployment.

Shares support saved-version links, server-rendered social metadata, and generated
PNG cards. Browser document views and image crawlers no longer count as agent reads;
explicit machine reads do. Search is paginated, 24 entries per page.

## Verification

- Usual full suite after consolidation/rename: 334 passed, 5 skipped.
- Thought Swarm after star counter: 77 passed; TypeScript check passed.
- Usual keyboard: 11 portable Swift tests and 10 service tests passed.
- Bait Shopify: 13 tests passed after relocation.
- Homepage route/content suite: 5 passed; desktop and 390px mobile checked.
- Product registry and catalog validators passed.
- Control-plane ownership/fleet path edits remain mixed with pre-existing work in
  that repository and were not swept into a commit. Preserve others' changes.
- Portfolio inventory scan completed after consolidation.

## X drafts (not posted by Codex)

Original launch thread: https://x.com/paulljump/status/2114706974411800962
Paul wants the S-1 post to quote/reply to that launch. Final draft:

> Started with Apple’s docs. Now Anthropic’s S-1 is in Thought Swarm.
>
> Claude turned the filing into a shared digest. Your agent can reuse it instead of processing the whole thing again.
>
> Read it yourself, or send it to your agent:
> https://thoughtswarm.tryusual.com/s/648eda74f7f99f4f

Final launch-thread source reply draft:

> Open source. Part of Usual.
>
> We store public document snapshots and digests so the next agent can reuse what’s already been read. robots.txt is respected.
>
> Try Thought Swarm:
> https://thoughtswarm.tryusual.com/
>
> All the tools, one repo:
> https://github.com/pauljump/usual
