# Bait Lab: first executable commercial test

Decision: October 5, 2026 ET. Status: local product built; no launch, orders or
customer validation. This is an agent-selected bet under Paul's current request
to turn Bait into a low-touch business without delegating routine decisions back
to him. It is not a prediction of revenue.

## Choice

Sell a $29, one-time, self-serve downloadable regression kit to a developer who
owns HTTP credential-verification logic. The purchase trigger is an upcoming
release or a misleading verification result. The deliverable is 12 synthetic
cases, a local HTTP fixture server, process-adapter runner, CI results, source and
measurement notes. Three cases are free to establish fit before checkout.

The source is MIT licensed, including redistribution rights. The offer sells a
prepared release and convenience, not exclusive data or proprietary algorithms.
That limits defensibility and must be clear before purchase. No recurring promise
is made until buyers show repeat demand and we can maintain a useful release pace.

**Most likely failure:** this is a small amount of code competent developers can
write themselves, and the adapters are not drop-in integrations with major tools.
The test has to show that packaging the awkward cases is worth $29. It may not be.
Do not expand the catalog, add billing infrastructure or claim a moat to evade
that question. No buyer interviews or willingness-to-pay evidence exist yet.

## Why the fresh data changes the bet

Private source: `~/.usual/bait/captures/20261006T015012Z/`, compared with October 2.
Public-safe observations are in FIELD-NOTES.md; raw observations stay private.

- 39 additional planted credentials were observed again; 62 additional uses.
- Latest 20 events are Git-remote submissions for three credential identifiers,
  around 8–10 days after first recorded collection. This is a bounded sample.
- The first-use histogram has 8 credentials over seven days, despite a 19-second
  median. There is a delayed tail worth preserving in tests and reporting.
- Earlier Redis values appeared in web-login requests. This motivates a protocol
  mismatch exercise. It does not establish a Redis client or successful login.
- Deep-maze count remains zero. More maze depth has no demonstrated commercial value.

None of this proves a scanner produced a false positive, used a cache, was operated
by an attacker, or will buy software. The synthetic exercises test plausible
engineering mistakes independently of those unknowns. We are productizing a
testing workflow inspired by the data, not selling the data as a forensic replay.

## Alternatives considered

| Route | Economic appeal | Main obstacle | Decision |
| --- | --- | --- | --- |
| Sell raw behavior feed | Recurring licensing | Small, repetitive sample; no coverage comparison; procurement and custom integration | Defer |
| Managed Bait at $5–15/month | Broad self-serve audience | Free tripwires/tarpits; multi-tenant operations and unmeasured quota cost; no demonstrated recurring owner task | Defer |
| Consultant/MSSP reports | Existing spending category | Sales cycle and client-specific interpretation; conflicts with low owner work | Reject as first route |
| Sponsor amusing field reports | Keeps public Bait's voice | We have bot observations, not a verified human audience advertisers will buy | Use the story for acquisition, not a revenue forecast |
| Mark licensed datasets | Potentially valuable attribution | Requires consenting distributors and controlled exclusive issuance; new infrastructure and sales | Separate future experiment |
| Agent challenge environment | Potential repeat software purchase | Today's observed clients aren't identified AI agents; free benchmarks; much broader grading problem | Narrow to credential-verification tests |
| Downloadable Bait Lab | Fulfilled immediately, no hosted runtime, low price/no sales call | Small niche and DIY substitute; buyers still unproven | First bounded commercial test |

## Evidence from the market

Sources checked October 6 UTC. These establish alternatives/workflows, not demand.

- [Truffle Security verification engineering](https://trufflesecurity.com/blog/how-trufflehog-verifies-secrets): endpoint and response semantics, network failures and test maintenance are real engineering concerns. We do not assert its tools fail Bait Lab.
- [Custom verification webhooks](https://trufflesecurity.com/docs/custom-detectors): a documented integration concept. Bait Lab's adapter is independent; no TruffleHog integration has been verified.
- [SecretBench](https://github.com/setu1421/SecretBench): a substantial free secret-detection dataset. A collection of key-shaped strings would have little differentiation.
- [Canarytokens](https://docs.canarytokens.org/): free hosted tripwires. We should not charge simply for a planted string.
- [Gumroad pricing](https://gumroad.com/pricing): published direct-sale fee 10% + $0.50; Discover sales 30%; no monthly platform charge. Its merchant-of-record role handles sales-tax collection/remittance for its transactions, not Paul's entire tax situation.
- [Gumroad product setup](https://gumroad.com/help/article/149-adding-a-product): use its native digital-product checkout/delivery, not a custom payment system.

## Price and arithmetic

$29 is a proposed experiment price, not a researched willingness-to-pay result.
At the published direct fee, $29 - $2.90 - $0.50 = **$25.60 per order** before
refunds, other applicable deductions, income tax, maintenance and support.
Discover's 30% would leave $20.30 under the same simplified assumptions.

| Direct orders/month | Gross | After modeled platform fee only |
| ---: | ---: | ---: |
| 10 | $290 | $256 |
| 50 | $1,450 | $1,280 |
| 100 | $2,900 | $2,560 |
| 200 | $5,800 | $5,120 |

These are scenarios, not forecasts. There is no evidenced acquisition volume.
At an assumed $50/hour labor value, ten minutes of support costs $8.33/order.
That consumes nearly one third of fee-adjusted receipts. Custom adapters and
onboarding calls are excluded; fixing reproducible pack defects is included.
Agent execution is not costless; track actual session/operating expense separately.

## Acquisition and decision rule

Use one useful public field story with the free runnable sample, a clear full-pack
offer, and an attributable link. Drafts are in `launch/LISTING.md` and
`launch/POSTS.md`. They are unsent. The first distribution choice is Paul's existing
X account, where the public Bait project already points. This is a channel
hypothesis; no audience size or expected reach was verified.

Primary funnel: approved field-story post → canonical Bait Lab page → free sample
or Gumroad checkout → automatic digital delivery. Do not count bot probes or
sample HTTP requests as humans. Payment receipts are the source of truth for sales.
No paid ads, cold messages, scraped contact lists, bulk posting or paid APIs.

The 14-day experiment clock starts only when checkout works and the approved post
is published. Neither has happened. Check at day 7 and day 14 when a user-authorized
run occurs; no background schedule was created.

- Continue if at least three unrelated buyers pay, at least two voluntarily confirm
  they ran their own adapter or adopted a case, and total support stays under 30
  minutes per buyer. Those are provisional decision thresholds, not statistical proof.
- If there is little qualified human exposure, label the result a distribution
  failure/inconclusive demand. Do not interpret zero sales after bot traffic as rejection.
- If roughly 100 relevant human visits/sample users yield no sales, pause product
  expansion and inspect feedback. Human qualification will be imperfect; do not
  manufacture a precise conversion denominator from raw access logs.
- If free users run it but do not pay, test ONE changed offer based on their stated
  missing value. Do not automatically build 100 more fixtures.
- A later annual release subscription is eligible only after repeat paid demand
  and a repeatable case supply. This one-time pack alone is not meaningful recurring revenue.

## Owner involvement and remaining external actions

The agent owns packaging, instructions, code fixes, artifact verification, drafts
and analysis. Gumroad would own standard checkout and file delivery. No custom
backend, standing server, or provider inference is required for buyers.

Still required: an authorized seller account with payout setup, approval of the
exact $29 listing/refund offer, upload/full delivery check, canonical website
publication and the exact X post. No credentials were requested or read. If an
existing seller account is available, use it; do not silently create a new account
or accept provider terms. Payment, delivery and customer use remain unverified.

These boundaries come from the current portfolio AGENTS.md and the tool messaging
rules, not historical “do not build” language. All local preparatory work proceeds.
Publication is a single concrete launch decision after reviewing this packet.

## Product/architecture contract

Canonical code stays in `pauljump/usual`, `products/bait-lab/`, on main. It shares
Bait's evidence and identity; it is a downloadable companion, not an independently
operated SaaS or separate repository. Public Bait retains SPITE.md's voice and
behavior. No Worker routes, decoys, live counters or Shopify app were changed.
The public server has a disabled-by-default asset integration; no live service was
restarted or reconfigured. Commerce uses Gumroad's native digital-download flow after approval;
the canonical marketing page is proposed at `https://tryusual.com/bait/lab/` through
the existing documented Mini/Cloudflare Tunnel deployment. No Sites hosting.

`build.py` outputs a public directory containing only the free sample and page,
plus a separate private delivery directory containing the full ZIP. It never
publishes. Do not serve the output parent. Raw traffic, owner files and runtime
secrets are excluded by an explicit file allowlist. A supplied approved checkout
URL enables the button; the default page openly disables payment.
