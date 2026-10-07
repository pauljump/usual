# Let them show their next move

Paul's direction, 2026-09-27: investigate more broadly before narrowing the product.
Understand what different visitors attempt when given convincing opportunities,
and what their requests can actually reveal about their origin. Public Bait keeps
the revenge and delight in [SPITE.md](SPITE.md). Its private evidence must earn our
confidence. A busy trap is not automatically a valuable business.

## Owner activity report: what did they actually do?

Product direction, 2026-10-03: the owner should be able to understand observed
client behavior, not just traffic totals. The report answers: what was exposed,
which credential returned, which operation was requested, how our decoy replied,
and what request followed. Each statement must point to recorded evidence.
The objective is a useful explanation for the person running Bait; commercial
packaging is a separate, unvalidated question.

A first offline implementation is `scripts/bait/activity-report.mjs`. It reads
saved public stats or the JSON output of `investigation-report.mjs` and produces
plain-language Markdown or `--json`. It performs no network calls or inference.

```sh
node scripts/bait/activity-report.mjs /private/stats.json
node scripts/bait/activity-report.mjs /private/investigation.json --json
```

The output has three layers: observed actions with source JSON pointers, labelled
interpretations, and explicit gaps. Public stats support credential-submission
trails only; the bounded recent list is not a full history. Private reports also
support verified-session sequences and response-stream endings. Those two views
may overlap and must not be summed. Synthetic provenance and truncated displays
remain visible. Neither mode identifies an operator or assumes authentication
success from a credential match.

For example, the October 2 saved snapshot records four Redis credentials in HTTP
login submissions. The report describes that literally and offers generic
credential replay as an interpretation. It does not claim a Redis connection,
successful intrusion, resale or four independent bots. Snapshot source times stay
visible; a generated report does not turn old data into fresh observations.

### Next collection increment (designed, not implemented or deployed)

Use one versioned action receipt for each supported decoy request:

| Field | Purpose |
| --- | --- |
| Event ID, observation time, source | Evidence reference and separation of runtime/owner/synthetic traffic |
| Credential/exposure reference and signed session reference | Link only what the evidence supports; retain shared-reader ambiguity |
| Method, normalized route class, operation label | Say what was requested without arbitrary URL/query content |
| Classification basis and parser version | Distinguish a route match from a validated operation shape |
| Bounded request features | AI model allowlist class, stream flag, body-size bucket; hosting operation and presence flags |
| Response status, response recipe/version, stream end | Show what our emulator returned, including rejection or incomplete replies |
| Experiment assignment and timing policy | Explain whether response behavior could affect the next step |
| Retention/window status | Distinguish missing, pruned and still-open observation windows |

Do not retain raw prompts, passwords, authorization headers, uploaded contents or
arbitrary destination URLs for this feature. Unknown model names become an
`other` class, not copied text. Parsing remains bounded and never triggers remote
lookups, execution or outbound operations. An AI route match is not proof of a
valid completion request; current AI handler labels are therefore described as
handler selection in the first report.

The owner view should lead with a short observed sequence, then show evidence,
our response, interpretation and unknowns. For example: configuration requested
→ credential submitted 32 hours later → file list requested → upload attempted.
Only display steps actually retained. A stream ending is not acknowledgement
that a client consumed it. Never fill missing steps using a model narrative.

Acceptance for a future live rollout: a normal local client completes each
supported protocol sequence; every narrative claim resolves to a receipt;
retries and shared credentials cannot inflate unique-client claims; parser and
response errors are visible; collection cost and retention are measured. Compare
fast and slow replies with the same protocol payload in a separately identified
cohort before deciding how much slowing preserves useful observation.

The first offline report is implemented locally. The richer receipt fields,
automated capture/delivery and an owner-facing live view remain future work.
No deployment, production export, experiment activation or scheduled job is
included in this change. Verify deployment state separately from local source.

## What changed locally

Measured learning streams now retain a small private evidence object alongside
their existing operation, credential and signed-session references:

- Visible ASN and country from the edge/integration, when available.
- A keyed daily egress group, separate from the existing tool group. Changing
  tools on one visible IP need not look like changing the network too.
- A keyed transport group from optional edge TLS/HTTP metadata. No paid
  fingerprint service, external lookup or new database query is required.
- Explicit runtime/synthetic provenance. Runtime is not proof of an unsolicited
  bot; owner checks and human visits still need to be considered.

The evidence adds one nullable column to `bait_learning_visit` and uses its existing
insert, checkpoint deduplication and seven-day/20,000-row retention. Each stored
object is capped at 512 characters. No new raw IP, body, auth header, cookie or
submitted destination is included. Legacy scrape/trip logs remain unchanged.
This adds up to two HMAC operations per measured request and some stored bytes;
it is not zero resource usage or a new account-wide quota guard.

The report command reads an existing local capture, with no export, live request,
migration, background job or provider call:

```sh
node scripts/bait/investigation-report.mjs /private/local.sqlite
node scripts/bait/investigation-report.mjs /private/local.sqlite --json
```

It shows retained workflows, session/network changes, credential trails, tool
lookalikes and coverage gaps. Synthetic rows are excluded unless
`--include-synthetic` is requested. Old captures without the column get a
diagnostic; old or malformed rows are counted as missing evidence, not made into
new observations. No production data has been refreshed for this change.

Group displays are bounded to 100 sessions, 100 credentials and 50 tool groups;
each workflow displays at most 40 steps/transitions. Truncation is explicit.
Reports omit raw hostnames and request paths but should still be kept private.
The public scoreboard and its definition of real measurements are unchanged.

## What counts as evidence

| Observation | Supported conclusion | What remains unknown |
| --- | --- | --- |
| Same verified signed session on two ASNs | That session was presented through two visible networks | One rotating proxy, shared cookie, separate workers or separate people |
| Same recorded fake-credential digest reused | Requests are linked to that credential record | Path-stable bait has multiple readers; legacy short digests can collide; no proof of resale/handoff |
| Same tool or transport group | Similar client request/handshake characteristics | Shared libraries, impersonation, proxy termination and unrelated users |
| File upload, mail-account or scheduled-job request | A particular operation was attempted against our decoy | Whether it would succeed elsewhere, what campaign it serves, or who owns it |
| ASN and country | Edge-reported network attribution | Operator name, residence, physical device or original address behind a proxy |
| No later request in the capture | No retained observed follow-up | Timeout, unsupported reply, pruning, third-party action, or a client that stopped |

Egress groups rotate daily. The report compares them only within the same day;
midnight alone does not become a claimed network change. ASN comparisons work
across days where both are known. Missing fields remain unknown. A matching
fingerprint never merges sessions into an identified operator.

Cloudflare documents the optional request metadata used here in its
[Workers Request API](https://developers.cloudflare.com/workers/runtime-apis/request/).
Client-cipher/extension hashes, TLS version/cipher and HTTP version are hints;
they are not a home-grown JA4. We omit the changing TLS client random. The existing
tool fingerprint stays unchanged to preserve cohort assignments. Full Cloudflare
[JA3/JA4 requires purchased Enterprise Bot Management](https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint/);
this implementation neither requires nor enables it. Availability and CPU headroom
on our actual deployed Free Worker still require verification after an authorized
deployment; local Node checks cannot prove edge performance.

## Broader bait coverage

This is a coverage plan, not a claim that every emulator is built or every behavior
has been observed. Existing capabilities below refer to local code; the latest
local version is not yet deployed. Do not silently add traps to working app routes.

| Temptation | What we want to observe | Local capability | Next useful increment |
| --- | --- | --- | --- |
| Leaked configuration | Which key they choose, what they test first, which endpoint they use | Stable fake credentials, links, recognized reuse | Distinct exposure markers for a session's loot; public stable files retain their shared-reader caveat |
| Hosting account | Login → list files/mail/databases → upload/write/account/cron attempt | Disabled opt-in protocol-shaped login experiment and inert operations | Fast discovery responses and stateful fake write/read receipts, before selectively slowing the stream |
| Mail service | Validate a key vs create an account vs submit a message | Mail credential and hosting mail-account attempt | A bounded local HTTP send API; collect action/recipient-domain classifications, never deliver mail |
| AI quota | List models vs submit a completion/message | Small local protocol-shaped model/chat/message replies | Record requested model class, stream mode and bounded size buckets; no provider inference |
| Storage/backups | List metadata vs request objects vs paginate/download | Small XML listing and company export batches | More faithful local object GET/HEAD/range and pagination behavior; inert fake content only |
| Git and package registry | Read refs/history/secrets vs fetch package content or try to publish | Three-commit Git history, simple registry metadata | Coherent fake manifests and inert package archives; record publish attempts without publishing |
| WordPress/debug/webshell probes | Enumerate vs authenticate vs attempt a command | Origin-404 recipe coverage; no general command interpreter | Specific verified request shapes with canned results and bounded operation labels |
| Admin/API/GraphQL/Autodiscover | Which unsupported interfaces they keep asking for | Private candidate list, still 404 | Promote only a reviewed protocol implementation; frequency alone does not invent compatibility |
| Webhook/integration setup | Whether they supply a callback/destination and keep using it | Not implemented | A decoy settings API that acknowledges locally and records a minimal destination indicator; never fetch the submitted URL |
| Downloaded loot | Does another client later follow a link from a stolen document/archive? | Same-host maze/config links | Session-scoped signed HTTP receipts in inert loot; link retrieval is not proof a person opened a document |
| SSH/SMTP/database wire protocols | Commands and non-HTTP credential use | Not covered by this deployment | Separate architecture and cost decision; an HTTP-shaped fake does not emulate a TCP service |

No universal trap can show everything a bot would do. Coverage also depends on
which bots encounter our sites and accept our emulations. Adding a protocol must
include normal-client compatibility tests, origin preservation, inert mutations,
resource limits, measurement semantics and its still-unobservable behavior.

## Can we tempt them into revealing more of their origin?

Yes, as an experiment about infrastructure and workflow, not a promise of identity.
Give each signed session distinct fake artifacts that link back to our own HTTPS
endpoints. If a different worker or a later downloader requests one, that reveals
another visible part of the credential/artifact journey. A normal client may still
use the same proxy for every step. Link previews and automated inspections can
trigger requests too; label the retrieval rather than inventing a human action.

A decoy webhook or upload workflow may also cause a client to volunteer a domain
or destination. That is useful infrastructure evidence, but it might belong to a
proxy, compromised server, innocent service or decoy. Treat it as untrusted text,
minimize what is retained, never auto-fetch it, and never publish it as the operator's
identity. This capture is proposed, not included in the new evidence column.

DNS tripwires are a separate possible layer: a unique hostname can reveal a lookup,
as [Canarytokens documents](https://docs.canarytokens.org/guide/dns-token). DNS
resolver visibility is not the same as identifying the originating device. We have
not provisioned DNS logging, enabled a third-party canary, or authorized new costs.
The first implementation should stay on our existing HTTPS surface.

We do not need exploits, local-network probes, browser proxy bypass, executable
downloads or instructions to run commands on the visitor's device. Observing what
they voluntarily send to our decoys keeps the experiment on our own field.

## Learning before slowing

The old recipe score rewards long holds and follow-up requests. It does not
optimize for learning a visitor's intended workflow. A two-minute reply may prevent
the next request completely. Keep a separately identified research cohort with
fast, compatible discovery/login responses, then measure attempts deeper inside.
Do not rewrite the public counters or silently turn every tarpit into a fast API.

The existing hosting comparison changes response format and timing together, so
it cannot isolate either effect. A follow-on comparison should keep the payload
and protocol constant and vary timing only. Record assignment before serving,
compare cohorts rather than retries, display incomplete observation windows, and
retain an explicit exploration share so common scanners do not crowd out rare
behaviors. Broader investigation does not require all protocols to launch at once.

Research success: new reproducible operation sequences with enough provenance to
say what happened and enough fidelity to rule out our own broken reply. Business
success remains paid repeat use of a useful output, after checking buyer novelty,
operating cost and owner workload. Neither follows automatically from attribution.

## Validation and publication state

`node --no-warnings tests/bait_investigation_client.mjs` exercises signed-session
network changes, credential reuse across sessions, tool lookalikes, forged-header
exclusion, missing metadata, daily key rotation, synthetic/old-data handling,
counter deduplication and read-only reporting. All traffic is synthetic and local.
It runs through `python3 -m pytest -q` with the other Bait clients.

No manifest, routing, subscription or production data was changed for this work.
The deploy dry-run description now includes the evidence column. The previously
reviewed dry run predates this addition: run and review a fresh dry run before an
authorized apply. No new bait family or experiment has been activated.
