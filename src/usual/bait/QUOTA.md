# Keep the joke on their side

On 2026-09-27 Paul supplied a Cloudflare email reporting 76% of the account's
5,000,000 daily D1 row-read allowance used: approximately 3.8 million row reads,
with 1.2 million remaining at the email's timestamp. That is not a count of bot
requests and not a bill. The stated reset was September 28 at 00:00 UTC, or
September 27 at 8:00 p.m. America/New_York. The email is account-wide; it does not
attribute all usage to Bait or establish the current percentage.

[Cloudflare's D1 pricing documentation](https://developers.cloudflare.com/d1/platform/pricing/)
explains that rows scanned count even when a query returns few results. Free-tier
read/write limits reject queries when exhausted; upgrading is a separate action.
Workers waiting on a slow connection and D1 scanning rows are different resources.
Reaching this D1 cap can interrupt recording and database-backed responses. Bait's
origin wrapper catches database failures, but no claim is made that every site
continues normally if its own origin also depends on the exhausted D1 account.

## Local finding and fix

Learning previously ran this cleanup on every stream checkpoint:

```sql
DELETE FROM bait_learning_visit WHERE at < ? OR id IN
  (SELECT id FROM bait_learning_visit ORDER BY at DESC, id DESC LIMIT -1 OFFSET ?)
```

It scans the retained history even when nothing needs pruning. Slow streams save
checkpoints every ten seconds and on termination, multiplying that work.

The local fix splits expiry into an indexed `at` range delete and capacity into
an integer-rowid range delete using `max(rowid) - 20000`. SQLite can find the
maximum rowid directly. At steady state only rows actually due for eviction need
to be traversed, instead of rescanning the retained history. The capacity window
is insertion order; gaps can retain fewer than 20,000 rows. No existing table or
additional index is needed, and no public counter is reset or estimated.

The regression test populates more than 20,000 local synthetic visits, checks
the query plans of the actual cleanup statements, verifies age/cap retention, and
replays checkpoints after another table changes `last_insert_rowid()`. That guards
against accidentally deleting the history or double-counting stream measurements.
Local SQLite query plans demonstrate the scan removal; they are not measured D1
quota savings or proof that this query caused all of the account-wide alert.

## Remaining work before expanding traffic

- Attribute account usage by database using existing provider analytics, rather
  than running live SQL to discover how expensive live SQL is.
- Check the deployed revision against this fix, review a fresh deployment dry run,
  and publish only with applicable authorization. Local fixes do not reduce live
  usage until deployed.
- Measure actual D1 `rows_read` and `rows_written` from existing request metadata
  or analytics after deployment. Cached leaderboard computation, capacity counts,
  migrations and event inserts still consume resources. Extra indexes can cost
  writes; avoid adding them blindly while close to a limit.
- Establish headroom before activating broader decoys. The experiment's session
  cap and per-isolate stream cap are not account-wide quota limits.

No production SQL, plan upgrade, billing change or manual data deletion was done
to investigate this alert. Existing retention behavior was optimized in local code.

## Isolated production fix — 2026-09-27

After Paul approved deployment, the exact live 0.3.1 module was retrieved through
the Workers control API. Only the known cleanup block was patched; the unfinished
local 0.4.0 features were excluded. Deploy through the canonical entrypoint:

```sh
node scripts/bait/deploy.mjs --quota-fix /private/receipt-directory
node scripts/bait/deploy.mjs --quota-fix /private/receipt-directory --apply
```

The first call saves the original source, candidate, live settings and deployment
identity, and prints a dry run. Apply checks all of them again, refuses drift or
candidate tampering, uploads only the patched module, preserves existing binding
types (including the secret), and verifies downloaded source/settings and the new
100% deployment. This mode performs no D1 SQL, route edits, secret rotation,
schema change, resource creation or plan change. The original private source is
retained as a rollback artifact; rollback is not automatically executed.

Verified at 2026-09-27T21:26:33Z:

- Deployment: `91ac1aeb-68b3-48cc-9e00-223044a5d74a`.
- Worker version: `c41802ff-16cc-4ebd-818d-4a811614e148` (application label remains 0.3.1).
- Original SHA-256: `079b09a080ba68a09389c553b861dc3e43c4e2a6e966053f5c26502ce10301bd`.
- Deployed SHA-256: `1d0860ae8dfe9451dabed66ba8fc1e6b1ddfa1b154c6341982cee9a3022c4bb1`.
- All returned live settings match the pre-deployment snapshot.

The exact deployment candidate passed an offline 20,005-visit retention and
query-plan regression, counter replay checks, and mocked deployment guards. The
first full suite had one test-fixture newline-encoding failure; after correcting
the mock, its targeted rerun passed (the other 282 tests had passed, 5 skipped).
Actual D1 read savings remain unmeasured; no live traffic/SQL query was used as a
health check. Deployment does not reset today's already-consumed quota.

## Automatic saved score — local implementation, not yet deployed

The proposed Worker configuration enables `BAIT_SNAPSHOTS=true` and a 15-minute
Cron Trigger. The deploy script adds that schedule and preserves other triggers.
The current live 0.3.1 cleanup hotfix does not include this feature. Do not deploy
the pending 0.4 feature bundle merely to activate it without reviewing that scope.

A scheduled run reads existing aggregate counters, up to 20 most recently inserted
credential-use records (with indexed network/site lookups), a notice marker, and
up to 30 daily rows. It writes one JSON snapshot in the existing `bait_cache` table.
A shared lease allows at most one attempted builder every 900 seconds, including
failed attempts. Normal scheduling is 96 invocations a day; no all-history median,
ranking, learning or replay query runs in this path. No new tables or indexes.

Public `stats.json` reads only that saved row on cache miss. Edge copies are
checked at most every five minutes per cache location under normal conditions;
concurrent misses in one isolate share work. Query parameters reuse the same key.
The page polls every minute, with an explicit recorded timestamp. Healthy updates
normally arrive within about 20 minutes plus scheduling/propagation delay.

On database failure, an available last-good edge copy remains usable with its
original timestamp. Edge retention is best-effort, up to 24 hours from its last
successful database read; eviction/cold locations can return 503. A loaded page
keeps its existing score. Failed reads back off five minutes within an isolate.
Cold isolates/locations can still perform point reads or fail independently; this
is not a global request limiter. Scheduled failure never overwrites the saved row.

The JSON declares `bait-public-snapshot-v1`. Uncomputed detail is null or omitted,
not zero. Learning results, historical rankings and session replays remain in the
separate local reports. The snapshot preserves any local simulation notice, so
synthetic previews cannot silently acquire a real-traffic label. New installations
need their normal schema initialization before the first scheduled snapshot; until
then the endpoint says unavailable. Existing counters are never reset or seeded.

Cost boundaries: Free D1 allows 5 million rows read and 100,000 rows written per
UTC day across the account. This change makes each scheduled build a fixed-size
summary, but exact D1 row accounting has not been measured in production. A cache
hit uses no D1; a miss uses a primary-key lookup. Bot recording still consumes
reads/writes, indexes can add writes, and Worker request/CPU allowances are
separate. No upgrade, paid storage, external model or agent automation is needed.
This reduces refresh usage; it cannot guarantee the account never exhausts quota.

Offline verification: `node --no-warnings tests/bait_snapshot_client.mjs` tests
known counters, bounded recent results, duplicate cron leases, failed build
preservation/backoff, single-row reads, cache concurrency/query normalization,
HEAD requests, stale fallback, eviction and corrupt-data rejection.
