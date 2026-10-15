# Turrii decision context — frozen 2026-10-14

This is working material for a private product jam. It separates observed facts,
reasonable inferences, and open questions. It does not claim access to Turrii's
closed source, private analytics, classifier, thresholds, or internal roadmap.

## Product and public evidence

Turrii, formerly not-slop.com, is a Chrome extension for recording how text enters
ordinary web editors and publishing a shareable “Verified Human” proof page. Its
public surfaces emphasize LinkedIn and Substack writing. The product shows a
0–100 Creation Confidence score, typed/pasted/untracked proportions, an optional
typing replay, public proof IDs/pages, and public author profiles.

As observed on 2026-10-14, the Chrome Web Store listed version 0.2.5, updated
2026-10-08, with about eight users and one rating. Pricing was Free (1,000 verified
characters/month), Plus ($2.99/month), and Pro ($5.99/month). The public sitemap
showed four profiles. Treat these as a small and changing public sample, not proof
of retention or willingness to pay.

Turrii says its server signs a content hash plus author, tier, and timestamp with
Ed25519. Public pages expose capture tiers. The extension tier is bounded below
the announced desktop/hardware/screen/camera tiers. Public examples show scores,
typed/pasted measures, capture-key status, and replay. The landing page describes
future stronger capture and optional identity checks.

## What the mechanism can and cannot establish

The directly observed facts are browser events: characters arriving one by one,
paste/input events, edits, timing, pauses, and the text state seen by the extension.
Typed versus pasted classification is useful and comparatively legible. A
human-likeness score is an inference from timing and editing patterns, not direct
evidence about where the ideas or wording originated.

The public product does not disclose a classifier, thresholds, validation set,
false-positive/false-negative rates, or independent evaluation. Therefore the
reliability of “Creation Confidence” cannot be assessed from public evidence.
Keystroke dynamics, paste detection, event replay, cryptographic signing, and
document provenance are established techniques. The more distinctive packaging
is a portable public receipt tied to a specific published text in everyday web
editors.

The central attack is semantic: an AI can generate text, and a person or agent can
retype it with plausible delays and edits. Browser events can support “this text
arrived through these inputs on this device under these capture conditions.” They
cannot by themselves prove “a human originated the words or ideas.” Stronger
attestation can make the recorder harder to tamper with, but it does not resolve
off-device generation, coaching, transcription, or human retyping of AI output.

## Adjacent products and useful analogies

Adjacent mechanisms include Grammarly Authorship, GPTZero Origin, Turnitin Draft
Coach/process evidence, Draftback revision replay, Originality.ai, TypingDNA, and
C2PA-style signed provenance. Writing-progress products such as Authorlytica,
TrackBear, 4theWords, WritingHabit, DragonWriter, and WordTracker are closer to
“Strava for writing,” but usually track sessions, streaks, or word counts rather
than attaching a trace to one published text.

A compact analogy is: Strava for writing, with a DocuSign-like integrity seal,
displayed like a blue check. The caveat is important: DocuSign proves an approval
event and record integrity, not that the signer authored every word. Turrii's
process capture is richer, but “authorship” remains an overclaim unless defined
narrowly.

## Demand and who pays

The strongest shared conclusion from the product jams was that individual writers
have weak incentive to buy a generic “human” badge. The badge has little value
until readers or platforms recognize it, and most writers do not want more friction
or a public score that can misclassify them. This creates a two-sided adoption
problem.

The party with a decision to make has clearer potential willingness to pay:
platforms moderating or ranking content, schools evaluating process, employers
checking work, publishers enforcing disclosure, or regulated workflows recording
review and approval. Those buyers need auditable facts and policy controls, not a
single universal humanity score.

### Authorized voice

An alternative wedge is authorized voice rather than human purity: record who was
responsible, which tools participated, what was reviewed, and what artifact was
approved. For AI-assisted code, a useful receipt might say: directed and approved
by a named person, generated with an agent, diff/commit hash fixed at approval.
That is responsibility attribution, not a claim that every character was human-
typed.

## Product-shape tension

Turrii currently spans three shapes:

1. a low-price personal subscription for writers;
2. a social reputation network of proof pages and profiles;
3. provenance infrastructure for organizations and platforms.

The first is easiest to ship but has the weakest economic pull. The second needs a
feed, follows, groups, challenges, comparisons, or another repeat social loop to
be truly Strava-like; proof pages alone are receipts, not a network. The third has
the clearest buyer but requires integrations, policy semantics, enterprise trust,
and careful claims.

The most opinionated creator version would be a public work record for people whose
reputation depends on original thought. The trace is inspectable evidence; the
person's body of work and responsibility are the main event. Show facts such as
typed, pasted, revised, capture tier, and gaps. Avoid collapsing them into a moral
score.

## Supplied brand and GTM direction

A founder-supplied 75-slide Turrii brief and go-to-market deck was reviewed on
2026-10-14. It is product direction, not independent market evidence. It defines
Turrii as verification for human-created thought leadership on LinkedIn and
Substack, aimed broadly at U.S. technology thought leaders, professionals, and
enthusiasts. Its primary KPI is plugin downloads; awareness and positive sentiment
are secondary.

The proposed product loop is concrete: a Turrii button appears in the editor; a
post that clears a 70%+ human-created threshold receives a compact public line with
fixed black, purple, and white bookends plus a unique proof code; the post then
appears on the writer's Turrii profile with a more detailed breakdown. The brief
explicitly allows light AI editing and says AI itself is not the enemy. Its three
levels match the public free, $2.99, and $5.99 tiers, with progressively greater
capture depth but the same outward accreditation.

The deck's own grounding insight is the strategic crux: verification becomes useful
only after enough respected thought leaders display it, so the launch plan seeks
scale quickly. One strategy recruits 10 or more technology voices who have already
complained about slop, then staggers their posts across two weeks. An alternate
strategy creates an invitation-only “Turrii 10 Founders” cohort and opens access in
scarce batches. Supporting ideas include high-frequency owned social, explainers,
testimonials, a “Slop Cop,” a community leaderboard, media exclusives, a podcast
blitz, and more theatrical launch stunts.

This direction sharpens rather than resolves the core questions. The deck contains
both a wide-adoption strategy and an exclusivity strategy; it treats downloads as
the primary KPI even though the product's value depends on reader recognition and
checker behavior; and some campaign ideas accuse or rank “slop” despite the more
careful product claim that AI-assisted writing can still qualify. A jam should keep
the useful product sequence—capture, receipt, public record—separate from the
unvalidated assumption that a creator-led anti-slop movement supplies durable
demand.

## Agent-side opportunity

A more commercially compelling adjacent product may serve agent developers rather
than writers: an interaction-realism evaluation platform. It would capture and
score typing, mouse movement, scrolling, pauses, corrections, focus changes, and
form behavior; replay failures; compare agent traces with human baselines; and run
in browser-agent development and red-team loops.

That opportunity should be framed as compatibility, quality, accessibility, and
evaluation—not as helping bots impersonate people or bypass anti-abuse systems.
A company cannot credibly sell both a trusted human certificate and a tool whose
purpose is defeating that certificate. The clean choices are separate products,
an explicit red-team/evaluation business, or a proof product designed around
declared agent participation rather than supposed bot exclusion.

## Candidate tests

The cheapest proposed demand test is to hand-send about 20 “typed by me” receipt
links in real conversations for one week. It can test whether recipients click,
understand, ask questions, trust the receipt, or reuse/share it. It cannot validate
the classifier, security, scalable distribution, recurring use, or willingness to
pay. Sending links without a decision context mostly measures novelty.

A stronger version recruits a checker with a live decision: a moderator, editor,
teacher, hiring manager, or community operator. Give them 10–20 real items with a
fact-based receipt, observe what decision it changes, and ask what evidence is
missing. Success is repeated voluntary inspection or a changed decision—not polite
interest from authors.

For the agent-evaluation direction, the cheapest test is a small benchmark: collect
human and agent interaction traces for the same bounded browser tasks, expose
replay plus interpretable measures, and see whether two or three agent teams use it
to find and fix failures. Do not market or optimize it as anti-detection evasion.

## Decisions still open

- Is the core promise “show how this text entered,” “establish responsibility,” or
  “evaluate interface behavior”? Only the first is supported by the current trace.
- Which checker has a frequent, costly decision that the receipt changes?
- What raw facts should replace or sit above Creation Confidence?
- Does the social layer create durable participation, or distract from a B2B
  provenance wedge?
- Is the agent-evaluation opportunity the actual company, a separate red-team tool,
  or a dangerous conflict with the trust product?
- What result in a one-week test would cause the team to stop, narrow, or pivot?

## Source map

Local working research:

- `barkey/research/proof-of-human-writing-landscape.md`
- `barkey/jams/2026-10-14-proof-of-human-what-and-who-pays.md`
- `barkey/jams/2026-10-14-proof-of-human-the-how.md`

Public surfaces reviewed include `turrii.com`, its public proof/profile pages,
privacy policy, sitemap, and Chrome Web Store listing. Product facts may change;
each jam freezes this context so later edits do not silently rewrite its record.
