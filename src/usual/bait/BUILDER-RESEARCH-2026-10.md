# Bait for builders: useful, inexpensive, and worth keeping

Research checked 2026-10-04. Public documentation, source repositories and research
papers; no product trials, customer interviews, live Bait refreshes, paid APIs,
deployments or new services. Product capabilities below are documented claims,
not independently tested performance. Recommendations are hypotheses.

## Finding

A free builder product is plausible. The opportunity is not a novel honeytoken,
maze, IP list or serverless deployment. All have substantial free competition.
The candidate worth testing is a small, app-native observation tool that explains
credential misuse and subsequent requests, preserves the owner's evidence, and
helps the owner test a relevant control. Its advantage would be integration,
clarity, measured cost and useful follow-through. Those advantages remain unproven.

Proposed promise: **See what took the bait, what it tried next, and what your app
should do about it. Keep the evidence in your own account.**

This complements the public fun in [SPITE.md](SPITE.md); it does not establish a
security guarantee or replace a WAF. The initial audience is a developer operating
a small web application who sees unexplained probes in logs and does not want to
operate a separate security stack. Hobbyists may value curiosity; production
builders need a concrete decision, test or saved investigation time.

## What already exists

| Category / example | Documented offering and cost boundary | Implication for Bait |
| --- | --- | --- |
| [Canarytokens](https://docs.canarytokens.org/) | Hosted tokens are free. HTTP and AWS tokens cover important tripwire use cases. | We cannot claim to democratize a previously paid basic tripwire. |
| [AWS Canarytoken](https://docs.canarytokens.org/guide/aws-keys-token.html) | Detects planted credentials used at AWS APIs via AWS logging; alerts may be delayed. | Stronger off-site visibility than an arbitrary fake key checked only at our endpoint. |
| [GitGuardian](https://www.gitguardian.com/pricing) | Free secret monitoring; its pricing page places Honeytoken in NHI Governance and describes paid endpoint protection. Public page mixes plan presentations; no reliable standalone honeytoken price was verified. | Managed credential deployment and governance are paid adjacencies, not evidence that a small free token is new. |
| [GitGuardian event details](https://docs.gitguardian.com/honeytoken/understand-events) | Timestamps, visible IP/country, user agent and AWS action. | Our reporting must add more than a timestamp and an ASN. |
| [Cloudflare AI Labyrinth](https://blog.cloudflare.com/ai-labyrinth/) | Linked decoy pages for inappropriate crawlers, offered including Free. | An endless maze is a distribution feature, not an obvious paid feature to undercut. |
| [AI Crawl Control](https://developers.cloudflare.com/ai-crawl-control/get-started/) | Free crawler identification relies on user agents; documented free metrics window is 24 hours. | Owned history and credential-action evidence could complement it; we cannot replicate its paid detection merely by changing retention. |
| [Vercel BotID](https://vercel.com/docs/botid) | Basic is free. Pro Deep Analysis is $1 per 1,000 calls, with custom Enterprise pricing. | An observable paid unit exists, but its browser classification is a different job. Bait does not replace it. |
| [Arcjet](https://arcjet.com/about) | Company page lists $25/month Individual, $299/month/application Startup plus usage, and a 10,000-request free plan after trial. | Developer-friendly protection is already sold. Its broader controls cannot be equated with Bait's decoy coverage. |
| [GreyNoise Swarm](https://docs.greynoise.io/docs/swarm-faqs) | Free sensor program with a one-time $1 verification; documented free history is 2 days for consumer email and 10 for business email. GreyNoise claims ownership of collected data and restricts commercial redistribution. | Rich free competition. Owner-controlled retention and data portability are plausible differences; a larger sensor network alone is not a moat. |
| [GreyNoise Tactics](https://docs.greynoise.io/docs/tactics) | Classified post-compromise commands, files and executables from eligible sensors. | Detailed downstream behavior is an existing capability, not an empty category. |
| [Cowrie](https://github.com/cowrie/cowrie) | Open-source SSH/Telnet interaction logging and emulation. | Better fit for shell/wire-protocol observation; adds a different deployment and maintenance surface. |
| [T-Pot](https://github.com/telekom-security/tpotce) | Open-source multi-honeypot platform; README asks for 8–16 GB RAM and 128 GB disk. | Free software can still be expensive to operate. A narrow web feature can avoid much of this footprint, with less coverage. |
| [web-tarpit](https://github.com/crumrine/web-tarpit) | MIT JavaScript traps, fake credentials, slow replies, method-aware XML-RPC and a Workers/D1 dashboard. | Direct overlap. A simple trap plus chart is not an unserved niche. README assertions were not benchmarked. |
| [honeytoken-ecosystem](https://github.com/dblanko/honeytoken-ecosystem) | Open-source CLI, Worker catcher, optional PostgreSQL listener and AWS logging integration. Documents an Azure detection limitation. | Credential instrumentation on Workers also already exists; study its integration and visibility limits before rebuilding. |
| [hono-honeypot](https://github.com/ph33nx/hono-honeypot) | Framework middleware for suspicious paths, optional IP strikes/bans and reporting. | Easy framework setup and local blocking alone are crowded. |
| [Sasoi](https://github.com/allsmog/Sasoi) | Describes Worker-based orchestration with multiple Claude-powered analysis roles. | Deterministic receipts offer a cost distinction from this architecture. No need to pay for inference per visitor. |
| [Interactsh](https://github.com/projectdiscovery/interactsh) | Open-source out-of-band interaction collection, including self-hosting. | Generic callback collection is already available; Bait needs context and interpretation. |
| [GoAccess](https://goaccess.io/get-started) | Local web-log analysis with HTML reporting. | A baseline alternative for understanding requests without installing decoys. |

Additional free substitutes: [Turnstile](https://developers.cloudflare.com/turnstile/plans/)
for challenges, [CrowdSec's community list](https://docs.crowdsec.net/docs/central_api/community_blocklist/)
for shared reputation, and [Anubis](https://github.com/TecharoHQ/anubis/blob/main/docs/docs/design/how-anubis-works.mdx)
for proof-of-work challenges. Their existence weakens a generic free-bot-blocker
pitch. Bait can link to or interoperate with useful existing tools.

## What is expensive elsewhere that can be inexpensive here?

The defensible comparison is selected workflow capability, not feature parity with
an enterprise suite. Expensive software prices also cover reliability, support,
research and integrations; cheap execution does not eliminate those obligations.

| Proposed capability | Builder outcome | Cost mechanism | Priority / uncertainty |
| --- | --- | --- | --- |
| Plain-language request and credential timeline | Understand a suspicious sequence without reading many raw logs | Fixed labels and evidence links; no runtime inference | First. Must beat ordinary logs in a real owner task. |
| Longer owner-controlled history and export | Compare today with last month; keep evidence after uninstalling | Bounded compact rows, local exports, retained summaries | First. Raw unlimited history is not free. |
| Recognized-credential callback linked to exposure | Know a planted value was submitted again, where and when | Keyed identifiers and a small receiver | First. Public stable values do not identify which reader reused them. |
| A local regression fixture from a sequence | Verify one's own route/auth/rate-limit behavior | Sanitized fixtures and local test execution | Second. Operation labels alone are not a faithful replay; needs explicit validity rules. |
| User-approved short-lived response rule | Make a chosen defensive change based on an observed action | Existing native rules or app middleware | Later. Requires false-positive evaluation, expiry and rollback; never classify all users of an ASN as abusive. |
| Traps in developer workspaces and build outputs | Detect use of a decoy placed in a chosen private location | Inert planted values plus a receiver | Separate experiment. Existing Canarytokens/GitGuardian overlap; local file reads do not cause a remote callback. |
| AI-scraper source tracing | Evidence about which scraper supplied content to an AI response | Unique markers plus controlled queries to models | Research-only. Querying models adds cost and output absence is inconclusive. |
| Full compromise emulation | Observe arbitrary shell/payload behavior | Isolated runtimes, storage and operational supervision | Poor fit for essentially free and low owner effort. |

The strongest free bundle would therefore be **decoys + readable evidence + owned
history + export**, with a later local-test feature. No hosted LLM, browser session,
paid enrichment request, real AI credit or virtual machine is needed per visitor.
We have not demonstrated that this bundle is meaningfully easier than competitors.

## Visibility: what we can and cannot answer

There are three distinct observation mechanisms:

1. **Our endpoint receives the planted value.** Cheap and under our control.
   Bait already observes this. It misses use against another provider.
2. **A legitimate provider observes an instrumented credential.** AWS honeytokens
   demonstrate this route. It needs provider-specific logging and configuration;
   a plausible-looking random string is insufficient.
3. **An artifact reappears elsewhere.** Unique links, aliases or textual markers can
   provide evidence of later use. A callback does not reveal all intermediate
   copies, resales or people. Mail/DNS monitoring is additional infrastructure.

The saved October 2 Bait snapshot has 85 distinct reused credentials and 318
submissions, including Redis values submitted to HTTP login endpoints, but no
recorded deep-maze requests. This is evidence of reuse, not successful Redis
connections, operator identity or a complete chain of custody. See
[the activity design](INVESTIGATION.md#owner-activity-report-what-did-they-actually-do)
and private capture `/Users/mini-home/.usual/bait/captures/20261002T230514Z/`.

[HoneyCirculator](https://link.springer.com/article/10.1007/s10207-017-0361-5)
is particularly relevant prior research: bait credentials led into decoy web
systems, enabling observation of later activity and infrastructure. This supports
the mechanism, not the novelty or business demand for Bait.

Two recent preprints suggest useful experiments, not established product guarantees:

- [Identifying AI Web Scrapers Using Canary Tokens](https://arxiv.org/abs/2605.13706)
  reports serving unique markers to scrapers and checking their appearance in
  outputs from 22 production LLM systems. The implication is controlled
  source-tracing research; it is not passive proof of model training or a free
  universal AI-bot identifier.
- [Ghost Without Shell](https://arxiv.org/abs/2606.28006) reports that 99.23% of
  authenticated sessions in its SSH deployment were non-interactive. This does
  not describe our HTTP population, but reinforces measuring actual protocol
  operations rather than assuming longer sessions mean better intelligence.

## What “essentially free” can honestly mean

Three separate promises must not be confused: free software, no incremental
invoice for a small installation, and free centrally hosted service at any scale.
Only the first is unconditional; the second depends on existing account usage;
the third is not supported.

[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
lists 100,000 free requests/day, with 10 ms CPU per invocation. Paid Standard
starts at $5/month with 10 million requests and 30 million CPU-ms included;
excess rates are $0.30/million requests and $0.02/million CPU-ms. Waiting duration
is not billed like CPU, but invocations and recording still consume resources.

[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) lists free
allowances of 5 million rows read/day, 100,000 rows written/day and 5 GB storage.
Paid allowances include 25 billion reads and 50 million writes/month; excess
writes cost $1/million. Inserts, updates, deletes and index maintenance affect
usage. A batch reduces calls, not the billed number of rows. Free allowances
are shared with other workloads; full-table scans make small result sets costly.

Illustrative model, NOT measured Bait costs: one routed request per event,
2 ms CPU/request, 4 total billed row writes/event including associated work,
10 rows read/event, one paid account. Storage, notifications, backups, domains,
support and taxes are excluded. These are scenario assumptions, not estimates of
our current checkpoint-heavy implementation.

| Recorded events/month | Workers base + requests + CPU | D1 excess writes | Modeled subtotal |
| ---: | ---: | ---: | ---: |
| 10 million | $5.00 | $0.00 | $5.00 |
| 100 million | $35.40 | $350.00 | $385.40 |
| 1 billion | $341.40 | $3,950.00 | $4,291.40 |

The table is reproduced in `builder-cost-scenarios.json` alongside its assumptions.
All three scenarios remain below the paid included read allowance under the stated
10-row assumption. Retaining 1 KB per event would add roughly 10/100/1,000 GB of
raw data per month respectively before indexes and metadata; physical database
limits and sharding become important before a single cheap total tells the story.

For a small owner: 1,000 recorded events/day at four writes each would use 4,000
writes/day, before any uncounted work. This suggests room under the free allowance,
not a guarantee. Our current tarpit checkpoints and counter updates must be
measured independently. [QUOTA.md](QUOTA.md) already documents a real read-amplifier
incident and the distinction between a fix and measured savings.

At one million installations and 100 events/installation/day, a central service
would receive 100 million events/day. Free per-install software is plausible;
one central free-tier account serving all those users is not. Customer-hosted
instances decentralize cost but increase installation/support complexity.

### Architecture consistent with the cost goal

Use the existing app's native server middleware, or a Cloudflare Worker installed
in the owner's account. Start with explicitly reserved decoy routes and
origin-404-gated supported probes; do not shadow real login/admin/API routes.
Broad Worker routing bills all routed requests, including normal traffic. Narrow
routes reduce cost but lose discovery coverage; show that tradeoff at setup.
The Shopify proxy-only adapter cannot truthfully advertise whole-site interception.
A browser snippet cannot observe server-side scans of `/.env`.

Generate fixed protocol replies locally. Store compact action receipts, coalesce
repetitive probes with explicitly sampled counts, preserve rare action transitions,
and bound per-site and global retention. Provide cached summaries and on-demand
exports rather than constant polling and raw-log streaming. Retention deletes,
indexes, counters and dashboard reads belong in the measured budget.

Start with a proposed seven-day detailed window plus 30-day compact summaries,
subject to measured quotas. Export lets owners retain more using their own storage.
Keep useful local reporting available without contributing data to a shared network.
If there is later a hosted tier, it needs tenant verification, event/byte limits,
visible loss/sampling counters and an explicit over-limit policy. An application
cap cannot stop all incoming provider request charges; do not call it a hard spend
cap unless the provider configuration actually enforces that promise.

Prefer quick compatible replies for observation experiments. Use slow streams only
where they produce demonstrated value; repeated stream checkpoints are optional
measurement costs, not a requirement for understanding a submitted operation.

## Recommended validation before a larger build

These are proposed acceptance gates, not experiments already run or authorization
to contact people/deploy services.

1. **Baseline comparison, offline.** Use one fixed set of owned synthetic workflows
   against Bait, ordinary access logs, and the closest open-source alternatives.
   Compare setup steps, evidence retained, redaction, duplicate handling, response
   fidelity and whether the report distinguishes attempts from outcomes. Do not
   grade by dashboard aesthetics or number of fields.
2. **Builder task test.** Recruit five consenting builders. Give them a sample and
   ask what occurred, what is uncertain, and what they would do next. Proposed
   gate: four can answer correctly in two minutes; at least three identify a useful
   decision or a test they would keep. Curiosity alone is a separate outcome.
3. **Cost and integration test.** Proposed target: median installation under ten
   minutes; 1,000 events/day with routine work below 10% of D1 free daily reads and
   writes, enough CPU headroom, and normal routes unchanged. Verify measured edge
   CPU and row metrics before making a free-tier claim. Test exhaustion behavior.
4. **Small authorized field study.** Ten owned/consenting installations for 14 days,
   with a fixed event budget. Record actionable sequences, repeat report use,
   optional rule/test adoption, support time and incremental cost. Compare fast
   and slow responses with identical payloads. Report insufficient traffic honestly.
5. **Continuation decision.** Proceed if owners return because it answers a useful
   question and operating cost stays bounded. If we only rediscover ordinary
   `/.env` scanning, keep Bait as a fun lightweight utility rather than building
   a commercial intelligence platform around it.

At scale, measure new behavior patterns per additional site, not cumulative hits.
Sites that only repeat existing observations add cost without proportional
information. Shared evidence would need opt-in provenance, poisoning resistance,
redaction and clear contribution rights. A network effect is a hypothesis until
other installations make an individual owner's result measurably better.

## Decision and unresolved work

Recommended first bet: a free, owner-hosted web observation kit with understandable
credential journeys, retained evidence and useful export. Its commercial extension
could be convenience, team workflows or managed retention later. None has buyer
validation, and owner-hosted distribution is not an automatic low-support business.

The most consequential uncertainty is whether the report changes a builder's
behavior or just provides entertainment. We should test that before broader
emulation, a shared data marketplace, premium analytics or a model-powered analyst.

This research changes our confidence, not deployment state. No assertion that we
are the first, that paid protection is replaced, that reported clients are people,
or that hosting will remain free at arbitrary traffic is supported.
