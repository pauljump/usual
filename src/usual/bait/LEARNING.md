# Every wrong turn teaches us something

[SPITE.md](SPITE.md) is the product contract. This loop lives inside Bait's Worker:
real traffic teaches it which of our fake doors keep getting opened. No scheduler,
LLM, inference provider, external callback, or code generated from requests.

Enable `BAIT_LEARNING=true` with tarpit mode and D1. The library takes
`learning: true` and `maxActiveTarpits: 16`. The Worker uses
`bait.handleWithOrigin(request, originFetch, context)`. A Web Request integration
can use the same wrapper. Plain Node middleware still handles existing secret
traps and reserved maze paths; it cannot see the application's eventual 404.
Use the origin wrapper in an adapter if that installation should learn 404s.

## What gets a door

Known fake-secret routes keep their existing behavior. Additional Git, debug,
WordPress, root PHP, selected configuration and named backup probes get a fake
response **only after the current origin response is 404**. A later working page,
redirect, authentication response, error or rate limit is preserved, even after
the path has been promoted. Ordinary 404s pass through. HEAD probes earn no credit.

Three observations from at least two daily client groups promote a supported
path into the menu. Fresh plans snapshot up to three promoted paths from the same
host. Existing plans retain their original links and selected recipe. Promotion
is a repetition heuristic; it is not proof of malicious intent or distinct people.

Interesting unsupported 404s under admin, versioned API, GraphQL, registry,
well-known, CGI, vendor, OWA and Autodiscover paths enter a private candidate list.
They stay 404 and never become links automatically. A new protocol family needs
a code change and local verification. The system continuously expands within the
reviewed families; it cannot invent reliable traps for every possible bot.

The eight `all` zones in `deploy/bait-worker.json` run this on proxied hostnames.
`polyfeeds.dev` shares its zone with another Worker and receives only the explicitly
listed routes on proxied subdomains. DNS-only hosts do not run the Worker. Bait is
not automatically installed on future sites outside this manifest.

The separate [hosting-login experiment](HOSTING-EXPERIMENT.md) is opt-in and currently
disabled. It compares the existing company response with a promptly completed
protocol-shaped login, then records bounded inert hosting-operation attempts.
Its offline report is separate from the existing recipe heuristic.

## What they get

- **Config/archive:** stable fake secrets with links to more rooms.
- **Git:** valid loose objects, HEAD and refs. A normal dumb-HTTP `git clone` gets
  three commits: an old deployment, a credential-removal commit, and migration
  notes. The current `.env` points deeper; the older commit holds fake credentials
  and a company login. No executable payloads or hooks.
- **API:** finite pages of fake records with another page and config link.
- **Reused keys:** locally generated OpenAI/Anthropic-shaped replies, storage XML,
  registry metadata or paginated JSON. Only a recognized Bait credential opens
  these replies outside the reserved maze. No real model calls or storage reads.
  These are deliberately small protocol imitations, not complete vendor emulators.
  Clients that ignore our endpoint URLs and call actual providers are invisible here.
- **Company:** fake configs advertise a login under `/_archive/company/<plan>/`.
  An issued Bait credential opens a consistent fictional company with people,
  projects, migration notes, exports, and Paul's note linking to `@paulljump`.
  Sessions last 24 hours, use signed host/plan-bound cookies, and are HttpOnly,
  Secure and SameSite=Strict. No real account is created. Unrecognized credentials
  never open the company; ordinary application logins still pass through.
- **Exports:** each request yields a small deterministic batch or progress page
  pointing to the next cursor. HTML, JSON and CSV use the same slow-stream budget.
  No job queue, background export, scheduler or provider runs while the client is
  away. Each response stays within the existing 64 KiB cap; cursors have a
  practical 24-digit limit, like maze depth.

Recipe choice applies to a new host/path/family plan. Until each recipe has five
measured streams for that family, a deterministic hash spreads new plans across
archive/API/Git. Then four fifths favor the largest `mean held seconds + 30 ×
follow-up share`; one fifth continues exploring. Assignments are persisted before
serving. This is a heuristic over observed requests, not a causal A/B experiment.
Deleting the store loses learned assignments; keep it with the deployment secret.

The new namespace `/_archive/h/<plan>/<depth>/<node>/<file>` carries the original
plan through descendants. It has bounded URL length and practical 24-digit depth.
The original nine-way maze continues alongside it. All doors stay on the same host.

## What we can honestly count

`learning` is public aggregate JSON: observed/promoted/candidate paths, stable
plans, and per-family/recipe requests, follow-ups, credential uses, observed time,
and bytes. The page shows which bait earned more wrong turns. Zero means zero.

A follow-up is a request to a linked maze URL; it does not prove the previous page
was read. Time is server-observed stream lifetime, bytes are handed to the stream,
and money/client CPU is not measured. Busy-cap responses count only their actual
short time and actual bytes. Cumulative writes share the tarpit's idempotent
connection checkpoints, including duplicate/out-of-order delivery protection.
Simulation and backfill events cannot train the learner or seed these counters.

`replays` publishes up to six company sessions with at least two observed
requests from the last seven days, ranked by observed stream time. Each shows
its first twelve retained steps and totals across its retained requests. The
session identifier is a keyed digest, not the cookie or an authentication token.
Labels come from a fixed list; hostnames, paths, IPs, fingerprints, credentials
and submitted content are excluded. A signed session groups requests, not a
verified person or bot. No inference of reading content or unique identity is
made. Expired or evicted traces can remove a replay; these are recent receipts,
not permanent public archives. Old visits without sessions are not reconstructed.
The public page can copy these recorded visits for sharing; local test and saved
snapshot previews disable sharing. Replays share the stats cache and add bounded
D1 reads when it refreshes; additional requests still consume normal edge quotas.

The private trace stores query-free paths, operations, plan IDs, a keyed tool
fingerprint, and a keyed **daily** client group across participating sites.
Reused stable keys also link back to their first recorded bait plan, including
cross-site reuse. That identifies a credential's journey, not which reader reused
it when several clients fetched the same URL. Neither fingerprint proves a
person's identity. No submitted prompts, bodies or auth headers
are copied into this trace. Existing legacy scrape/trip logging remains unchanged.

The additive private [investigation evidence](INVESTIGATION.md) records visible
ASN/country and keyed daily egress/transport groups with runtime/synthetic provenance.
Its local `investigation-report.mjs` joins signed-session and credential observations,
labels network changes and tool lookalikes, and exposes missing evidence explicitly.
It adds no enrichment provider or public identity claims.

`node scripts/bait/learning-report.mjs /private/path/bait.sqlite --json` reads a
local capture/export without contacting a provider. It shows candidate paths,
recipe outcomes, tool cohorts and recent steps. Keep output private; it includes
hostnames. A production D1 export/query consumes provider quota and is separate
from this local report; this command does not silently do one.

## Keep our own bill bounded where we can

Each body is at most 64 KiB. Default slow duration is 120 seconds (maximum 300).
At most 16 slow streams are admitted **per isolate**, configurable from 1 to 64;
overflow gets a finite immediate reply. Cancellation releases its slot. This is
not an account-wide request, storage or spend cap: Cloudflare can create more
isolates and every request still has a cost.

Plans cap at 10,000, observed paths at 1,000, client memberships at 32 per path.
At those caps, existing entries continue; new plans fall back to existing traps
or the origin. Learning traces retain at most 20,000 rows and seven days, pruned
on traffic. Aggregate scores and existing tarpit idempotency/credential/log tables
remain; their storage grows with traffic. Checkpoints now do additional D1 writes
for the learning aggregates. Pausing learning does not reset either scoreboard.

The local quota fix uses separate indexed deletes for seven-day expiry and the
20,000-row insertion window. It replaces a full-history scan and sorted OFFSET
that previously ran on every stream checkpoint. Capacity now follows insertion
order; gaps can retain fewer than 20,000 rows, never more. It does not touch
aggregate scores or connection deduplication records. This reduces one known read
amplifier, not total D1 usage to zero. See [QUOTA.md](QUOTA.md).

## Verification and deployment

`python3 -m pytest -q tests/test_bait.py` runs entirely locally, including a real
Git clone, origin-response gating, stable plans, real stream accounting,
credential reuse, pagination, recipe selection, capacity and failure fallback.
No test fixtures or preview databases are imported into production.

Run `node scripts/bait/deploy.mjs` to review routes and bindings before `--apply`.
The additive tables initialize on the first request. Deployment keeps existing
credentials, counts and routes. The new manifest adds only explicit paths to
Polyfeeds; it does not take over its catch-all Worker.


## The public front door

The public page explains Bait through a measured score, a browser-only maze
example, and a clearly labeled Built / Next product direction. The example never
fetches trap URLs or changes counters. Unknown data stays unavailable, zero stays
zero, and old snapshots show their timestamp rather than pretending to be live.
Detailed counts and measurement limits sit behind a disclosure; the full stats
JSON stays available. Shared-network self-service and more protocol families are
presented as next steps, not already delivered features.

For local design review without creating traffic or querying a provider:
`node scripts/bait/preview.mjs --snapshot /private/path/saved-stats.json 8792`.
The snapshot is labeled on the page and is never imported into a database.

For the complete login/export/replay workflow, run
`node scripts/bait/preview.mjs --company 8795` and open `http://127.0.0.1:8795/`.
This uses only an in-memory SQLite database and a clearly labeled local test
score. It makes no provider calls and cannot import its counters into production.
