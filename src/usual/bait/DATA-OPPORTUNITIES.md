# What the bot data could be worth

Research date: 2026-09-27. These are business hypotheses, not approved product changes,
customer commitments, or evidence of willingness to pay. Bait's public product remains
the spite tool described in [SPITE.md](SPITE.md). Data licensing or a separate product
must not quietly turn its public experience into an enterprise console.

## Conclusion

Charging for installation or an endless maze is not yet supported by buyer evidence.
Cloudflare already offers AI Labyrinth on its Free plan. The potentially valuable
asset is a documented sequence: something only our system issued was later used in
a specific way. The next useful question is whether that evidence changes a buyer's
decision, and whether the buyer can already obtain equivalent evidence elsewhere.

The closest opportunity to the existing observations is a narrowly scoped behavior
dataset. The more distinctive adjacent opportunity is tracing the movement of licensed
data using synthetic markers. The fake-company software also has potential as a
controlled test environment, independently of the traffic dataset.

## Evidence we actually have

Source: saved public stats generated 2026-09-27T13:04:57Z, fetched once in the preceding
user-authorized turn; `/tmp/bait-stats-20260927T130548Z.json`. No new production queries
were made for this research.

- 4,182 recorded probes; 51,265 credentials handed out; 69 distinct credentials reused;
  160 recorded credential-use events. These are not counts of unique bots or operators.
- 65 of the reused credentials were database passwords, two mail passwords, two Redis
  URLs. That describes visible callbacks to us, not global demand for each secret type.
- Median observed first reuse: 19 seconds. 62 of the 69 first reuses were under a minute.
- The latest 20 reuse events all targeted malformed paths ending in `:2083/login/`.
  cPanel documents 2083 as its HTTPS login port. A cPanel-oriented password-reuse
  script is a plausible explanation, not a confirmed toolkit or operator identification.
- The aggregate `handoffShare` is 0.043478..., equivalent to 3/69. The implementation
  compares first-use and collection ASN values. It does not require both to be known.
  The underlying three records are not in the saved top-15 credential list. Therefore
  this is a lead to verify, not three demonstrated resales or even independently
  verified cross-network transfers. Shared stable credentials further limit attribution.
- The learner recorded zero linked-maze follow-ups, despite genuine credential reuse.
  We have not demonstrated prolonged navigation or identified LLM-driven clients.
- Time is observed server stream lifetime, not money lost or measured client CPU.
  There is no observed payment behavior, ad-fraud attribution, or recovered revenue.

The public snapshot is a summary, not a complete request history. Observed reactions
depend on our own timing, response shape and endpoint visibility. A stable token
served to several readers cannot establish which reader passed it to someone else.

## 1. License narrowly defined behavior evidence

**Proposed buyer:** a hosting, identity, anti-abuse or data-product vendor that needs
new, verifiable examples of credential-reuse behavior.

**Deliverable:** a small licensed dataset or API containing event time, issuance
context, observed reuse, response, coarse infrastructure context, suspected behavior
family, confidence and explicit provenance. A label such as "submitted a credential
issued by our decoy" is defensible. "Criminal" or "same person" is not.

**Why pay:** improve classification or investigation with examples absent from the
buyer's existing sources. Repeated malformed URL construction might identify a shared
implementation even when IP addresses change; it does not identify the operator.

**Market evidence:** GreyNoise markets OEM licensing of its observations. However,
its Community Dataset also collects contributed sensor data. This establishes a
commercial category and a powerful source of free competition; it is not evidence
that GreyNoise or another vendor would purchase our current sample. Spur similarly
combines behavioral and network observations at much greater scale.

**Smallest test:** assemble three redacted cases and a fixed-schema sample; ask a
prospective buyer to compare them with its existing coverage. Proceed only if the
buyer identifies a specific missing signal and agrees to a paid pilot or evaluation.
Do not build a feed business merely because IP addresses were collected.

**Limit:** our effective sample may be a few scanner implementations repeated many
times. Include benign/test controls, deduplication, retention and distribution rights.
Hashing an IP alone does not make detailed behavioral records anonymous.

## 2. Put a return address on data that leaves a business

**Proposed buyer:** a company licensing contact lists, catalogs or other valuable
structured data; alternatively, a company auditing the source of data it buys.

**Proposed product:** customer-approved markers in selected copies or deliveries,
with a record of which copy contained each marker. For suitable contact datasets,
use synthetic records and email aliases on domains we or the customer control.
For other data, use agreed harmless marker fields that survive normal processing
without changing material facts. Observe where a marker is later published, submitted
or emailed. Never involve a real person's address or seed unrelated third-party systems.

**Why pay:** identify an unlicensed redistribution channel, audit a supplier's origin
claims, or discover that a supposedly fresh list includes synthetic records collected
from a controlled source. The useful output is a source-and-reappearance record a
customer can investigate, not an unsupported accusation or automatic penalty.

**Evidence:** our credential callbacks demonstrate a small version of the mechanism.
Project Honey Pot maps planted email addresses to harvesting and subsequent spam;
commercial reputation products distribute this sort of evidence. Forensic watermarking
is also an established paid distribution-tracing mechanism in video. Applying it to
small structured-data businesses is an analogy and a product hypothesis, not proven
market whitespace.

**Smallest test:** use a tiny owned synthetic directory with distinguishable aliases
on separately logged surfaces. Alternatively, work with one consenting data owner on
a controlled delivery. Wait for independently observable reappearance. A controlled
test replay establishes plumbing only; unsolicited reappearance establishes a field
observation. Neither establishes buyer demand without a paying pilot.

**Limit:** an email proves use of an address, not the complete chain of brokers or a
sale. Markers can be stripped, forwarded, independently recollected or deliberately
replayed. High-integrity attribution needs exclusive issuance and exposure history.
Callbacks alone are insufficient to claim a particular customer leaked a dataset.

## 3. Sell a place for developers to test their own agents

**Proposed buyer:** crawler, browser-agent or workflow-automation developers.

**Product:** run their own software against a controlled fake company with known
answers: stale credentials, misleading navigation, inconsistent records, looping
exports and slow responses. Score task completion, correctness, recovery and whether
the client respects its time/request budget. Include solvable tasks and legitimate
exit conditions, not only traps designed to make every client fail.

**Why pay:** reproduce a costly failure before releasing an agent, compare a new
version with the previous one, and obtain fresh scenarios that have not been memorized.
Possible revenue is a scenario license or a private evaluation project. Customers run
their own models; Bait need not pay for inference to generate the environment.

**Evidence:** AgentDojo demonstrates demand for dynamic, controlled agent environments;
Braintrust sells evaluation infrastructure and Browserbase sells browser-agent
infrastructure. These establish adjacent activity, not willingness to pay for our
specific benchmark. Free benchmarks are substantial competition.

**Smallest test:** a five-scenario local package, deterministic scoring, and one
external developer reproducing a real bug in their own authorized client. Ask whether
they would purchase maintained/private scenarios. Do not label today's unidentified
scanners as AI agents or sell their traces as high-quality AI training data.

**Limit:** this monetizes the software more than the current dataset and is a separate
developer product, not an automatic next phase of the public Bait page.

## 4. Use decoy observations to audit traffic and lead quality

**Proposed buyer:** a lead buyer, analytics provider or paid-acquisition team.

**Value:** identify visits counted as leads or conversions that can also be connected
to a documented decoy interaction. Businesses already buy lead-fraud detection;
Anura's named customer case studies are examples of that existing spending category.

**Smallest test:** on a consenting site, measure whether the same properly scoped
session appears in both decoy events and real conversion events. Report the overlap
and uncertainty before suppressing traffic. If the populations do not overlap, stop.

**Limit:** no overlap has been demonstrated in our saved dataset. Secret scanners are
not automatically ad-click bots. IP/ASN matching alone can merge unrelated users.
This idea is economically legible but less supported by our current evidence.

## What I would prioritize

1. Preserve small, well-explained issuance-to-reuse examples. Improve attribution with
   separately tagged experimental exposures while keeping the deterministic maze stable.
2. Investigate the repeated login protocol and what response causes another observable
   action. The current evidence favors fixed scripts; a richer HTML company alone may
   not change their behavior.
3. Evaluate a behavior-data sample with a potential buyer before investing in a paid
   API. No unsolicited outreach is authorized by this research task.
4. Try the marked-data experiment as the more creative adjacent opportunity, on owned
   surfaces and within an explicitly approved resource budget.
5. Keep the test-environment idea available as a separate software opportunity if a
   developer supplies a real reproducible failure and commits to using it.

Revenue validation means an actual paid pilot, data license, or customer commitment
to a defined deliverable. Interest, traffic volume and attractive demo screenshots do
not meet that bar. Do not invent a subscription price before defining buyer value.

### Measurement improvements before expansion

- Distinguish probes, issued artifacts, unique credentials, requests and behavior
  families. Exclude known test traffic and do not count every token as a different bot.
- Separate controlled exposures from publicly replayable stable URLs; keep confidence
  attached to each relationship. Validate non-null network values for handoff analyses.
- Measure repeated implementations rather than assuming all changing IPs are new clients.
- Measure total origin and database cost alongside held time. More held connections
  are not proof of saved origin resources or profit.
- Use a bounded experimental control when comparing response behaviors. Slow delivery
  changes what we can observe; the current online recipe heuristic is not a causal test.
- Preserve consent, data minimization and redistribution rights before sharing any
  private observations. Public sample records should omit raw credentials and identifiers.

## Researched alternatives I would not prioritize

- Paid access for the scanners currently reusing fake passwords: no payment signal.
- A generic IP blacklist: strong incumbent and free coverage, weak demonstrated novelty.
- Selling ten hours of held connections as recovered dollars: no measured dollar value.
- A large AI training corpus: we have neither identified AI agents nor rich successful
  trajectories; repeated basic scanner events do not supply those labels.
- More maze depth as a monetization plan: zero observed linked follow-ups so far.
- Advertising impressions from bot requests: these are not a human advertising audience.

## Primary sources

Checked 2026-09-27. Vendor claims show products/categories, not independent performance
verification or proof that any named company would buy Bait data.

- [Cloudflare AI Labyrinth — includes Free plan availability and detection use](https://blog.cloudflare.com/ai-labyrinth/)
- [GreyNoise OEM licensing](https://www.greynoise.io/partners/oem-partners)
- [GreyNoise Community Dataset — sensor contributions and access](https://docs.greynoise.io/docs/using-the-greynoise-community-dataset)
- [GreyNoise dataset definitions](https://docs.greynoise.io/docs/understanding-greynoise-data-sets)
- [Spur detection methodology](https://docs.spur.us/knowledgebase/faqs/how-does-spur-detect-vpns-residential-proxies-and-isp-proxies)
- [Project Honey Pot API and collection-to-spam observations](https://www.projecthoneypot.org/httpbl_api.php)
- [Project Honey Pot commercial access](https://www.projecthoneypot.org/httpbl.php)
- [Spamhaus commercial data delivery](https://www.spamhaus.com/data-access/)
- [AWS account of Friend MTS watermarking and distribution tracing](https://aws.amazon.com/blogs/media/friend-mts-detecting-the-pirates/)
- [AgentDojo research paper](https://arxiv.org/abs/2406.13352)
- [Braintrust evaluation platform pricing](https://www.braintrust.dev/pricing)
- [Browserbase agent infrastructure pricing](https://www.browserbase.com/pricing)
- [Anura/Closed Loop customer case study](https://www.anura.io/closed-loop-case-study)
- [Cloudflare bot-detection methods](https://developers.cloudflare.com/bots/concepts/bot-detection-engines/)
- [cPanel official login-port documentation](https://docs.cpanel.net/knowledge-base/accounts/how-to-log-in-to-your-server-or-account/)
