# Bait is a spite tool

Read this before changing anything in `bait.js`. It decides what Bait is, and what it must
never quietly turn into.

## What this is

Bots hammer our sites all day asking for files that don't exist — `/.env`, `/.git/config`,
`/.aws/credentials` — hoping we slipped up. Bait exists to make that a bad idea for them.

The feeling that drives this product is **annoyance**, and the response is **spite**. Not
protection. Not peace of mind. Not a dashboard someone checks on Monday. The point is that
hitting our sites should waste the bot's time, burn its compute, and hand it garbage — and that
we get to watch it happen on a live scoreboard and laugh.

That is the whole thing. If a change makes Bait more useful to a worried professional and less
satisfying to a person who just wants to mess with bots, it's the wrong change.

## What this is not

- **Not a product you sell to a security team.** That market is crowded, high-touch, and no fun.
  We're not building a console for people paid to be paranoid.
- **Not a warning system.** We do not exist to tell someone "you leaked." Most people never
  worry about that and we're not going to teach them to.
- **Not framed in the vocabulary of that world.** No threat language, no jargon, no compliance
  posture. If a sentence sounds like it belongs in a vendor deck, cut it.

The category we belong to is closer to `endlessh`, tarpits, and the 10GB zip bomb: small,
mean, funny tools that spread because wasting a bot's time is *delightful* and the numbers are
worth screenshotting.

## How it spreads

Through the flex, not the fear. Someone runs Bait because it feels good and produces a number
they want to post — "these bots wasted 4,000 hours on my fake filesystem." The leaderboard is
the growth engine. Every stat we add should be a stat someone would screenshot.

The valuable byproduct — a live picture of who these bots are and how they behave — is
something we *harvest*, never the pitch. People show up for the revenge. We keep the data.

## The one rule: we play on our own field

The fun is in wasting their time, not breaking their stuff. Everything Bait does happens on
**our** servers with **our** nonsense:

- We waste their time and compute on machines we own.
- We feed them plausible garbage — fake files, fake secrets, fake directories, fake data.
- We pollute what they scrape so what they collect is worthless.

We never reach back into their machines. Not because we couldn't, but because the moment a tool
tries to *damage* the thing on the other end, it stops being a funny time-sink and becomes a
boring legal problem — and that's not where the fun is anyway. Time-sink and garbage beat a
payload every time. Keep it on our field.

## Where it's going

Paul's business objective, set on 2026-09-27, is a meaningful recurring revenue source
that needs little of his time. Public Bait keeps the spite and delight described here;
product decisions must also earn their place through buyer evidence, delivery cost,
and owner workload. The operating brief is [REVENUE.md](REVENUE.md).

The next moves are all deeper spite, not new seriousness:

1. **The tarpit.** When a bot takes the bait, don't just answer once and log it. Drop it into
   an endless fake filesystem — every fake `.env` leads to more fake directories, more fake
   secrets, more fake configs, forever. It thinks it hit the jackpot; it's actually stuck in a
   room with no far wall, burning its own resources.
2. **The counters.** Track and publish *time wasted* and *compute burned*. Those two numbers,
   next to the existing scoreboard, are the shareable hook.
3. **Poisoned loot.** Make the fake data we hand out actively worthless to whoever collects and
   resells it — plausible enough to keep, garbage enough to ruin the batch.

Every one of these is measured publicly in *how much of the bot's time and effort we wasted*.
That is the public score. The business is judged by retained paying customers, contribution
after operating costs, and how little recurring work it requires from Paul.
