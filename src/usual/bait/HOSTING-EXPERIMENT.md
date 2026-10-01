# One more move after the stolen password

Local implementation, 2026-09-27. Not activated in `deploy/bait-worker.json` and not
deployed. This tests the next-step hypothesis in [REVENUE.md](REVENUE.md); it does not
validate a paid product. Bait's public experience remains [SPITE.md](SPITE.md).

## The question

Our saved stats include recognized credentials submitted to paths ending in
`:2083/login/`. No deeper linked-maze navigation was recorded in that snapshot.
A script expecting a hosting login may ignore a generic HTML company response.
The experiment asks whether a protocol-shaped, promptly completed login produces
another observable request and, eventually, a useful attempted action.

This is a deliberately limited emulation, not a complete cPanel server or a claim
of compatibility with an identified bot toolkit. Official cPanel documentation
describes [session authentication](https://api.docs.cpanel.net/guides/guide-to-api-authentication/guide-to-api-authentication-secure-remote-logins)
and [UAPI/legacy request shapes](https://api.docs.cpanel.net/guides/guide-to-testing-custom-code).
The login JSON fields also appear in an [old firsthand client example on cPanel's forum](https://support.cpanel.net/hc/en-us/community/posts/19131198011927-cPanel-API-Authentication-questions).
That forum example is not a current official compatibility guarantee. Local test
clients validate our implementation; live traffic must test the hypothesis.

## Enrollment and comparison

Both options are required along with learning, tarpit mode and a supporting store:

- Library: `loginExperimentHosts: ["owned.example"]` and `loginExperimentUntil:
  "<explicit future ISO timestamp>"`.
- Worker: `BAIT_LOGIN_EXPERIMENT_HOSTS` is a comma-separated exact-host allowlist;
  `BAIT_LOGIN_EXPERIMENT_UNTIL` is the explicit timestamp. Neither is set in the
  current deployment manifest. The timestamp must be within seven days when a
  Worker instance starts. Enrollment stops at that fixed timestamp.

Only recognized issued Bait credentials on POST to the observed `:2083/login/`
shape, or `/login/?login_only=1`, qualify. Ordinary logins retain their existing
origin behavior. Missing, expired or invalid configuration leaves the experiment off.

The two arms are `company-slow` (existing HTML company) and `protocol-fast` (JSON
with status, redirect, security token and a signed cookie). Both use the existing
recorded fake-credential check. A keyed hash of host, IP and tool fingerprint fixes
the arm for a cohort across retries and process restarts. The enrollment table
stores the cohort digest, not a raw IP. NAT, shared tools and changing networks can
merge or split cohorts: these are not people or verified unique bots.

Assignment is saved before responding. The database atomically limits version
`hosting-login-v1` to 100 enrolled sessions across isolates, including repeat logins.
A caller can exhaust this small budget through retries; the report exposes cohort
counts. After the cap, the existing response remains in effect. Enrollment errors
use the existing fail-open wrapper. This cap bounds experiment sessions, not total
Worker traffic or account spending. No general billing guarantee is implied.

The arms change timing and format together. A difference cannot identify which
factor caused it. Open session windows, incomplete replies and evicted traces are
reported; a small sample must not be described as statistical proof.

## What the fake account can do

The fast login gives a `/cpsess##########` root with a signed, host/plan-bound cookie
whose path is restricted to that root. Every follow-up checks the cookie and the
recorded journey; guessing a numeric root does not authenticate. Sessions last at
most 24 hours or until the fixed experiment end, whichever is earlier. Unissued,
expired and other-host session paths pass through to the origin.

Recognized UAPI operations cover file listing/read/upload/write, mail-account
listing/creation, database listing, backup requests and scheduled-job attempts.
Selected legacy `json-api/cpanel` forms are recognized too. The home page links to
fake file, mail and database listings. Unknown operations get a finite generic 404
reply. No user input executes, creates a real account, sends mail, fetches a URL,
starts a job or reaches a model provider. Mutation replies are canned success
envelopes and do not implement a persistent virtual filesystem. Requesting an
operation is evidence of an attempt, not evidence of its purpose or completion.

The login streams immediately, using measured stream accounting. Follow-up replies
use the existing tarpit duration, byte and per-isolate admission limits. HEAD earns
no stream credit. Request reads are bounded by 64 KiB and a two-second timeout.
The handler recognizes login and session bodies without relying on Content-Length.

Private hosting traces contain a fixed operation label, normalized path, method,
time, journey and the existing keyed group/plan references. Arbitrary function
names, queries, submitted passwords, filenames, contents and session cookies are
not copied into those traces. The existing legacy credential-trip log is unchanged.
Public replay labels are fixed and contain no submitted content or private hosts.

## The offline deliverable

```
node scripts/bait/behavior-report.mjs /private/local-capture.sqlite
node scripts/bait/behavior-report.mjs /private/local-capture.sqlite --json
```

The command opens an existing local database read-only. It performs no live query,
export, migration or API call. Synthetic sessions are excluded unless explicitly
requested with `--include-synthetic`; isolated local clients set
`experimentSource: "synthetic"`. Runtime observations can still include humans or
owner tests and need provenance review. Old captures without the schema produce
a diagnostic, not invented zero counts.

The report groups retries, shows response completion and follow-up/action cohorts,
and produces at most ten candidate behavior packs with at most twenty displayed
steps each. A retained login is required to relate an action to it. Missing login
traces are flagged and never reconstructed. It includes operation-label fixtures
marked synthetic; these are not raw payloads or complete exploit replays. Revenue,
paying customers and renewal figures remain unknown because the capture contains
no sales records. A candidate pack needs usefulness, novelty and provenance review
before any buyer sees it.

Enrollment stores at most 100 rows for this experiment version. Request details
share the existing seven-day/20,000-row trace retention, so export timing matters.
The deploy script excludes experiment rows from historical seeding. It also prints
whether the manifest requests activation in its dry-run plan.

## Launch review still required

No hosting experiment is active. The local change adds no routes and no
manifest bindings. Before activation, choose explicitly owned hosts with full
Worker routing; a path-only zone such as polyfeeds.dev currently lacks `/cpsess*`
coverage and cannot run this workflow correctly without a separately reviewed route
change. No route has been added for it.

Inspect provider plan/quota information under the current authorization rules,
show `node scripts/bait/deploy.mjs` output, and obtain the required publication
authorization before `--apply`. The real dry run contacts Cloudflare's control API;
the offline report and test clients do not. CPU compatibility and total free-tier
headroom have not been established by these Node tests.

Verification: `node --no-warnings tests/bait_hosting_client.mjs` and
`python3 -m pytest -q tests/test_bait.py`. Coverage includes credential recognition,
both arms, stable cohorts, cookie/host/session scope, inert attempts and redaction,
real stream accounting, synthetic exclusion, read-only reporting, missing traces,
disabled defaults, origin preservation and the database enrollment cap.
