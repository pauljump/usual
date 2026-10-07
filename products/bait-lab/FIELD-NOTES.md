# Old bait, fresh requests

Observation cutoff: October 6, 2026, 01:50:12 UTC (October 5, 9:50 p.m. ET).

Bait's saved public aggregate reports 8,948 probes, 124 distinct planted
credentials observed again, and 380 recorded uses. Since October 2, the totals
grew by 1,876 probes, 39 reused credentials and 62 uses. These are observations
at our endpoints, not counts of people, successful intrusions or paying customers.

The latest bounded sample contains 20 Git-remote credential submissions involving
three recorded credential identifiers. Submissions happened approximately 8–10
days after the first recorded collection. Repeated identifiers appear through
several networks. A credential joins observations; it does not identify a person,
prove resale, or establish which of multiple readers supplied it.

Across the aggregate first-use histogram, 8 of 124 credentials were first observed
again after more than seven days. The median is just 19 seconds. Both matter:
the median alone hides the delayed tail. These delays are from first recorded
collection, not necessarily a particular client's collection time.

The October 2 snapshot also records four planted Redis URLs submitted to an HTTP
login, roughly 32–35 hours after collection. That is compatible with a generic
credential replay workflow. It does not demonstrate a Redis connection.

No recorded deep-maze requests appear in either snapshot. Real credential reuse
is a stronger finding here than the idea of an endlessly exploring crawler.

## What we turned into tests

- Git-remote observations motivate testing the authority and meaning of a response.
- Redis-at-login motivates testing a protocol mismatch.
- Delayed reuse motivates a stale-observation regression case.
- Additional negative and positive controls test status-code, body and retry handling.

The observed snapshots do **not** tell us what any scanner concluded, whether it
reported a false positive, which verification cache it used, or what response it
actually consumed. We do not claim that the source clients failed these tests.
The runnable cases are new synthetic exercises, not forensic reconstructions.

## Why this is a developer workflow worth testing

Truffle Security documents how endpoint choice, response bodies, rate limits and
network failures complicate verification. Its custom-detector interface also
supports local verification webhooks. Those are evidence that developers maintain
verification logic, not that they will buy this pack or that its tools are faulty.

Sources checked October 6, 2026:

- https://trufflesecurity.com/blog/how-trufflehog-verifies-secrets
- https://trufflesecurity.com/docs/custom-detectors
- https://github.com/setu1421/SecretBench (a free alternative for secret-detection datasets)
- https://docs.canarytokens.org/ (a free alternative for hosted tripwires)

No raw addresses, credential digests, captured request bodies or attributable
client sequences are included in this release. All source evidence stays private;
the release carries only the bounded aggregate observations above.
