# Bait: the first paid test

Internal draft, 2026-09-27. Not published, sent, priced in a checkout, or agreed with
a customer. This defines a purchase experiment under [REVENUE.md](REVENUE.md), not
a validated business. No external outreach is authorized by this document.

## What the additional research changes

Another generic feed is a weak offer. [CrowdSec's current console comparison](https://app.crowdsec.net/pricing)
already includes behavior/industry-specific lists, integrations and commercial resale
arrangements. [AbuseIPDB](https://www.abuseipdb.com/pricing) offers a free API tier and
a Basic tier advertised at $25/month. A handful of addresses is not a differentiated
replacement for these products.

[Imunify360](https://imunify360.com/imunify360/) describes a large hosting telemetry
network and automated defenses. [BitNinja's own comparison](https://bitninja.com/wp-content/uploads/2023/02/The_full_comparison.pdf)
describes honeypots feeding shared intelligence. Those are evidence that the hosting
category is served, not empty territory or proof these companies will buy our data.

There is a relevant distribution example: [Shield's CrowdSec partnership](https://getshieldsecurity.com/blog/crowdsec-partnership/)
shows a smaller WordPress product incorporating an external intelligence network.
It does not disclose that partnership's economics. Shield's WordPress focus also
does not match our current hosting-login observations well enough to justify a
sales claim. Treat it as evidence for a delivery pattern, not a qualified Bait lead.

Vendor claims have not been independently verified. We did not subscribe to their
APIs, query our observed IPs, or compare live coverage. No claim of earlier detection,
exclusive coverage or better accuracy is supported.

## One buyer and one proposed purchase

**Buyer profile:** a developer responsible for abuse detection in a hosting product,
with authority to buy external examples or test material and an existing way to
evaluate them. The first buyer must accept a standard artifact instead of needing
us to operate their defenses. A company selling adjacent software is not a lead
until we establish the relevant person, current need, authority and evaluation path.

**Proposed result:** one real credential-reuse sequence that adds a useful test or
recognition case to that buyer's existing tooling. Deliver the observation's
provenance, a sanitized sequence, uncertainty, and a runnable bounded fixture where
the retained evidence supports one. The fixture must say exactly which values are
observed, redacted or synthetic, and what its assertion establishes.

**Private price hypothesis:** $250 for a defined 30-day evaluation, offered only after
the buyer has inspected an eligible sample and agreed what success means. This is
an agent-proposed test price, not market evidence, an approved public price or a
forecast. No payment collection is implemented or authorized. Do not offer a
recurring subscription until repeat delivery is possible and the buyer wants it.

**Scope:** the accepted sample and qualifying updates during the evaluation, in one
documented format. No minimum flow of novel attacks can be promised yet. No bespoke
incident response, unlimited consulting, on-call coverage or custom deployment.
The buyer evaluates in its own test environment; no blocking changes are applied
automatically. A commercial license and payment terms would need separate preparation
and approval before sale; this draft is not a contract.

## What the sample must prove before it is offered

1. A retained runtime login and follow-up sequence exists. Known local tests and
   owner validation requests are excluded. A `runtime` database flag alone is not
   proof of unsolicited bot activity.
2. The sequence supports a specific observation beyond an ordinary secret-file
   probe or password check. A canned success reply does not establish that a real
   account, command or upload executed.
3. Provenance distinguishes credential issuance, response variant, session linkage
   and observation time. Shared credentials, shared networks and response shaping
   remain explicit limitations. No operator or campaign attribution is guessed.
4. The buyer can explain what the sample adds relative to its current data or tests.
   This comparison is performed by the buyer; we do not need paid competitor APIs.
5. The proposed fixture reproduces the stated check, has a negative/control example,
   and does not merely assert labels we assigned ourselves. If the retained data
   cannot support that fixture, the sample fails this offer's gate.
6. Delivery rights and redaction are checked. No customer data, submitted credentials,
   raw private request content or third-party feed data is quietly bundled for resale.

The current synthetic report does not pass these gates. Its operation-label fixture
is useful for checking the reporting pipeline, but is not a complete request replay,
exploit reproduction or validated detection. The new logger intentionally discards
submitted contents; some possible findings cannot be reconstructed from it. Do not
claim otherwise or collect more sensitive content automatically to fill that gap.

## The commercial test after an eligible sample exists

Prepare a short, redacted sample and show it to up to five qualified prospects after
explicit outreach authorization. Use a consistent proposed price and scope so we can
interpret responses. Record the buyer's existing alternative, usefulness verdict,
requested work, willingness to purchase and reason for declining. Avoid free custom
projects that make interest look like demand.

The central question is: **What test or operational decision would you change with
this sample, and would you purchase a repeat supply in this format?**

One actual evaluation payment establishes a first sale. An actual subsequent renewal
establishes initial evidence of recurring demand. Neither alone proves a sustainable
business. If five qualified prospects find the sample redundant, unactionable or too
sparse, reject this offer and inspect those reasons before adding product features.
Do not lower the evidence standard just to preserve this particular business model.

## Delivery designed around Paul's time

The intended workflow is: bounded observation capture → deterministic local report →
one provenance/usefulness review → a standard versioned package → authorized delivery.
The first review remains manual because the experiment cannot establish commercial
novelty by itself. Automate repetitive delivery only after a paying buyer validates
the artifact; do not build billing, a data API or a customer portal now.

Track all of Paul's time: initial setup, sales, sample review, support, billing,
exceptions and maintenance. Track automated infrastructure and provider costs too;
unknown cost is not zero. Recurring contribution is collected revenue less operating,
delivery, payment and refund costs; owner time remains a separate constraint.

For scale intuition only, twenty customers at the hypothetical $250/month price
would mean $5,000/month gross, before any costs. Holding Paul's involvement below
one hour/week gives roughly thirteen minutes per customer per month if every minute
were spent on customers; sales and shared maintenance reduce that allowance further.
This arithmetic illustrates why a consulting-heavy offer fails the objective. It
does not imply twenty customers exist or that the proposed price is acceptable.

## Current readiness

| Requirement | Current evidence | Result |
| --- | --- | --- |
| Local collection and reporting work | Scripted clients pass with isolated synthetic traffic | Ready for technical review |
| No-spend launch is feasible | Account plan/free-tier compatibility not conclusively verified | Unresolved |
| Live experiment is authorized and deployed | Activation bindings absent; approval request pending | Not launched |
| A useful unsolicited follow-up exists | Only the older password-reuse summary and synthetic new workflow | Not demonstrated |
| Buyer gets incremental value | No buyer comparison | Not demonstrated |
| Buyer pays and renews | No commercial evidence collected | Not demonstrated |
| Low owner workload and positive contribution | No operating customer cohort | Not demonstrated |

Do not claim progress in the last four rows from code completion or public traffic
counts. The next external step is the pending account check and deployment dry run;
publication remains a separate approval after reviewing that plan. No prospect has
been contacted and no sales promise has been made.
