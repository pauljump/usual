# Why site analytics still leaves an owner in the dark

Research: October 4, 2026 (America/New_York); local observations read early October 5 UTC. Scope: current public vendor documentation plus read-only Pulse source and SQLite inspection. No account API refresh, hosted account audit, installation, billing change or deployment. Product recommendations below are judgments, not proven customer demand.

## Finding

The difficulty is real, but the market is not missing analytics features. It is split across measurements that answer different questions. Browser behavior, edge traffic, application outcomes and security evidence overlap without being interchangeable. Tools increasingly combine them, but the owner still has to configure collection, reconcile identities and units, define success, and interpret uncertainty.

For Bait, the promising hypothesis is an understandable, evidence-backed explanation of observed traffic and collection gaps. “Free analytics with bots” is already competitive territory. PostHog explicitly supports browser events and server HTTP logs with query-time bot classification. We should use that as a baseline, not claim the combination is novel.

## What each observation can actually establish

| Observation | Useful answer | Cannot establish alone |
|---|---|---|
| Edge HTTP request | A request reached the proxy; URL, response and security metadata when collected | A person saw a page or intended to buy |
| Origin request | The application received a request | Cached requests or requests blocked upstream |
| Browser event | Instrumented client code reported an action | Definitely human, every visit, or a successful server outcome |
| Application event | Signup/payment/export succeeded according to the application | Why the visitor wanted it or where an untagged referral originated |
| Session replay | Reconstructed interactions in captured browser sessions | Uninstrumented traffic, off-site behavior or private motivation |
| Unique bait callback | A marker issued by us was subsequently presented at an observed endpoint | Identity of its operator, resale, or unseen use elsewhere |

These are not additive counts. A single visit can cause a document request, dozens of asset requests, pageview, scroll, several API calls and a signup event. A cached page can execute a beacon without a new origin document request. A scanner can cause thousands of requests without executing JavaScript. An AI browser can execute JavaScript. Even a perfect installation does not make request counts equal visitor counts.

## Google Analytics: powerful, but a mismatch for a complete traffic ledger

GA4 is useful for acquisition, campaign performance, events, key events and behavior analysis. It should not be dismissed as incapable of funnels or paths. Its complexity partly comes from needing to distinguish users, sessions, events and attribution scopes.

The decisive limitation for Bait's question: Google automatically excludes known bots and spiders, and says users cannot disable this or see the amount excluded. That deliberately removes part of the population we want to explain. Unknown automation may still appear; “in GA” does not mean “human.” [Google bot exclusion](https://support.google.com/analytics/answer/9888366)

Enhanced measurement supplies generic signals such as pageviews, outbound clicks, search and a scroll event at roughly 90% depth. It does not automatically know that our app successfully generated a quote, delivered a file or completed an onboarding task. Those need meaningful product events, preferably confirmed by the application for outcomes. [Enhanced measurement](https://support.google.com/analytics/answer/9216061)

“Direct / none” is missing clear referral information, not a reliable claim that someone typed the URL. Sharing through apps, missing campaign tags and unavailable referrers leave attribution gaps. [Direct traffic](https://support.google.com/analytics/answer/15258820)

Consent modeling requires eligibility and sufficient observations; it cannot reconstruct a missing individual's exact journey. Privacy thresholds can suppress eligible small-cohort reports. Sampling and reporting limits also exist, but should not be blamed for a small site's gaps without checking report diagnostics. Detailed retention settings affect exploration data differently from standard aggregate reports. [Consent modeling](https://support.google.com/analytics/answer/11161109), [thresholds](https://support.google.com/analytics/answer/9383630), [sampling](https://support.google.com/analytics/answer/13888627), [retention](https://support.google.com/analytics/answer/7667196)

Assessment: keep GA when its acquisition ecosystem answers useful questions. Replacing its UI alone cannot restore uncollected events, filtered bots or missing attribution.

## Cloudflare: multiple products under one name

Cloudflare Web Analytics uses a browser beacon. Edge analytics measures requests received by the proxy. These are different vantage points. Cloudflare documents beacon blocking, manual installation gaps, CSP restrictions, injection restrictions and payload loss. Being proxied through Cloudflare does not guarantee a complete browser behavior record. [Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/)

Edge visibility is valuable for automation, API requests, assets and traffic stopped before the application. It still needs classification and interpretation. A request for a sensitive filename is evidence of a probe; it is not proof of a successful compromise. Geographic and network labels do not identify a person. [Analytics differences](https://developers.cloudflare.com/analytics/faq/about-analytics/), [Bot Analytics](https://developers.cloudflare.com/bots/bot-analytics/)

A material current change: the Logpush pricing page, updated October 2, documents self-service availability on Free, Pro and Business. It lists 25 GB/month included for internal exports and 25 GB for external exports; overage is $0.03/GB and $0.10/GB respectively. Transformations have a separate allowance/rate. Destination storage and analysis cost extra; Workers Trace Events have separate pricing. Actual datasets/fields depend on account products. Do not repeat the old blanket claim that Logpush is Enterprise-only. [Pricing](https://developers.cloudflare.com/logs/logpush/pricing/), [availability and operation](https://developers.cloudflare.com/logs/logpush/)

Assessment: Cloudflare is an increasingly accessible source for the missing request layer. Exporting logs is not the same as giving an owner a useful explanation. This weakens a business based solely on charging for log access, while potentially making an explanation layer cheaper to run.

## The alternatives that matter

Prices and limits are public documentation snapshots, not account entitlements or guaranteed future terms. Free software still requires hosting and maintenance. Vendor capabilities are documented, not all independently tested in a live account.

| Product | Best fit | Entry economics / deployment | Remaining work for our question |
|---|---|---|---|
| PostHog | Product behavior, sessions, funnels, replay and broader developer analytics | Cloud free allowance: 1m analytics events and 5,000 recordings/month | Collect edge logs, define outcomes, reconcile observations and identities |
| Mixpanel | Funnels, retention, flows and product cohorts | Free: 1m events and 10,000 session replays/month | Event design and traffic coverage still need implementation |
| Amplitude | Product behavior and growth analysis | Free plan currently advertises 2m events/month; paid pricing varies by plan/unit | Semantics, identity and instrumentation remain necessary |
| Plausible | Readable acquisition, content and goal reporting | Paid hosted service; community self-host option | Intentionally filtered traffic is a poor full request ledger |
| Fathom | Simple site reporting and an all-sites overview | Hosted plans start at $15/month | Simplicity does not supply missing server outcomes or forensic history |
| Umami | Lightweight web reporting and session details | Self-host or Umami Cloud | Own collection reliability and outcome design; not automatically complete edge coverage |
| Matomo | Extensive analytics with control over data and hosting | Free on-premise core; hosting, premium capabilities and cloud can cost | Operational burden and configuration; data ownership is not data completeness |
| Microsoft Clarity | Understanding visible interaction friction through replay and heatmaps | Free service | Browser capture only; not a complete bot/request or business-outcome system |
| Rybbit | Modern web analytics with funnels, journeys and replay | Hosted trial and self-host option | Meaningful events still need instrumentation; assess overlap before building |
| Sentry | Explaining errors and performance problems in user journeys | Usage/plan-dependent developer observability | Excellent diagnostic context, not by itself an acquisition or full bot ledger |

Sources: [PostHog allowances](https://posthog.com/docs/self-host), [Mixpanel pricing](https://mixpanel.com/pricing/), [Amplitude pricing](https://www.amplitude.com/pricing), [Plausible](https://plausible.io/), [Fathom](https://usefathom.com/), [Umami Cloud](https://docs.umami.is/docs/cloud) and [sessions](https://docs.umami.is/docs/sessions), [Matomo costs](https://matomo.org/faq/new-to-piwik/faq_145/), [Clarity FAQ](https://learn.microsoft.com/clarity/faq/), [Rybbit features](https://rybbit.com/features), [Sentry replay diagnostics](https://sentry.io/resources/debugging-ecommerce-session-replay/).

Two particularly important competitors/tradeoffs:

- PostHog documents `$http_log` events from server/CDN/edge logs and query-time bot functions. Its own docs correctly call user-agent detection heuristic. This is direct overlap with “people plus bots,” including preserving observations instead of discarding them on ingestion. We still need to evaluate the owner experience and evidence quality; feature overlap is already established. [Official source documentation](https://github.com/PostHog/posthog.com/blob/master/contents/docs/web-analytics/bot-detection.mdx)
- Plausible explicitly acknowledges that aggressive datacenter filtering can exclude some VPN/Private Relay visitors. That is a concrete example of clean charts trading away coverage. It also acknowledges imperfect bot filtering. [Filtering documentation](https://plausible.io/docs/bot-traffic-filtering)

Clarity makes “free replay” a weak differentiation claim. Its ordinary playback retention is 30 days; favorited/labeled sessions and heatmaps last longer. The useful distinction is connecting a relevant failure or outcome to the right evidence, without forcing an owner to watch hours of recordings. [Retention](https://learn.microsoft.com/en-gb/clarity/setup-and-installation/data-retention)

## Your own sites: source-confirmed reasons for the frustration

This is a local audit, not proof that every inspected source file is currently deployed. Read-only SQLite queries used Julian-date comparisons for the rolling seven-day window. Counts are moving observations, not stable business metrics.

1. **Human classification differs between surfaces.** `pulse/lib/classify.ts` uses operator tags, bot flags, network heuristics, relay exceptions and a residential fallback. `lib/chartkit.tsx` defines a separate `HUMAN_SQL`; `lib/links.ts:40` uses `!bot && !hosting && !proxy`. `app/api/v1/sessions/route.ts:14` defaults to humans. A visitor can therefore be presented differently depending on the surface. Network category alone is not proof of automation or humanity.
2. **Your own activity materially affects small totals.** The inspected seven-day window contained 2,760 fleet event rows; 1,127 matched IPs tagged with a Paul label, approximately 41%. These are events, including app events, not website visitors. Tags can be incomplete or shared. This is enough to show why explicit operator separation matters, not enough to infer an exact external-human count.
3. **Collection has different clocks.** Latest fleet event was October 5 02:57:37 UTC. Latest edge event was October 4 13:53 UTC, with successful source run finishing 13:54:55. That is roughly a 13-hour mismatch at inspection. The collector is designed for periodic snapshots; this is not itself evidence of an outage.
4. **The edge table contains aggregates, not complete raw logs.** Seven-day inspection found 47,993 groups summing to 110,725 recorded requests. `scripts/cf-snapshot.cjs` requests `httpRequestsAdaptiveGroups`, grouped by IP, hostname, path and minute, with a 10,000 group limit per query. The observed run flags were uncapped, which does not prove absence of adaptive sampling or complete source coverage. Missing UA/status fields cannot be reconstructed from those rows.
5. **Coverage cannot be inferred from totals.** Events occurred under 75 property labels; edge groups under 139. These are labels, not verified site counts: aliases, APIs and app-only sources exist. A browser quiet site might be uninstrumented, private, API-only or simply quiet. A canary journey plus deployment inventory is needed to distinguish those cases.
6. **The migration itself is unfinished in the recorded project state.** `pulse/docs/POSTHOG-SETUP.md` says you chose hosted PostHog, and a bridge/coverage/dashboard implementation exists. It records no verified hosted project or credentials and no started bridge. I did not query an account or secret store to establish whether that later changed. This supersedes older notes saying PostHog was dropped. A coverage script's “one-zone” note is also stale relative to the collector's all-zone loop: even explanatory metadata needs verification.

These findings make “just install another dashboard” an incomplete remedy. We already have useful observations, but their definitions, freshness and joins need to be made trustworthy.

## Why this feels so hard

**The interfaces hide the measurement contract.** “Visitors” sounds factual, but depends on IDs, cookies, session windows, filters, consent, bot rules and time zones. The owner sees one number without the assumptions that generated it.

**Neither an IP nor a browser session is a person.** Shared networks merge people; VPNs and mobile networks move people; bots use residential proxies; humans use cloud browsers. A labeled outbound link may be opened by a security scanner. Identity should use explicit first-party account evidence when available, otherwise remain limited and probabilistic.

**Intent requires product context.** A pricing visit is observable. Serious buying intent is an inference. A successful checkout needs a confirmed outcome. Better instrumentation can narrow uncertainty; it cannot make motivation directly observable.

**Missing data is easy to confuse with no activity.** An empty chart needs a coverage state: verified collector with no events, stale source, filtered events, unsupported surface, or unknown. A successful sync only proves that particular sync succeeded.

**More automation can create convincing fiction.** An AI summary over incomplete logs can turn weak signals into confident narratives. Every explanation should distinguish observed action, inferred classification and unknowns, and open the underlying evidence.

## Recommendation and a testable product direction

First finish the existing measurement foundation and compare against PostHog. Do not begin by recreating its funnels, replay engine or all its dashboards. The owner already selected it in the recorded Pulse plan; verify that state before changing direction.

The first useful workflow should answer, for one site and time interval:

- What reached the site, in explicit units: requests, pageviews, sessions and confirmed outcomes?
- What looks like the owner, another person, known automation or uncertain traffic, and why?
- What happened next, using linked observations rather than assumed IP identity?
- Which sources were collecting, through what time, with what filtering/sampling limits?
- What action is worth taking, and which evidence supports it?

A bounded validation could use three representative sites: content, lead generation and an interactive application. Define five controlled journeys per site: operator visit, ordinary external visit, consent-denied/blocked beacon, simple non-JavaScript request, and a successful product action. Label tests explicitly. Compare what appears in browser collection, edge/application evidence and the report. This can validate coverage without claiming a complete bot ground-truth dataset.

Evaluate the experience by whether the owner can answer those five questions in two minutes, whether self-tests are correctly separated, whether every narrative has supporting observations, and whether blind spots are visible. Compare time-to-answer directly against configured PostHog and Cloudflare. If existing tools satisfy it, use them. If not, build the missing explanation and reconciliation workflow as a thin layer first.

Bait then supplies a special class of evidence: issued marker → observed reuse → exact action → limits of attribution. It should coexist with ordinary analytics without changing the meaning of their pageviews or sessions. A free owner-hosted layer may be feasible; free unlimited hosted raw traffic and replay is not a justified promise. See [builder economics and prior competitor research](BUILDER-RESEARCH-2026-10.md).

The strongest tentative pitch is: **Understand what reached your site, what it did, and what your analytics missed—with evidence behind every explanation.** The market research supports testing that experience. It does not yet establish willingness to pay or a durable advantage over existing vendors.
