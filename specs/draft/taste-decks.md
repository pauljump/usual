# Taste decks: tell Usual what you'd choose, in two minutes

History mining leaves gaps (Paul had hundreds of decisions on file and none about UI), and Usual has no place for answers you give directly: on 09-25, 8 form answers had nowhere to go. Add stated preferences as evidence, and decks to collect them, as the second path in onboarding and on tryusual.com.

## Building
- **Stated preferences, a new kind of evidence.** Each answer is stored with the exact question, the options, the chosen one, the domain, the date, and where it came from (a deck file or tryusual.com). It is kept separate from observed history and from reviewed predictions. `consult` returns it like other evidence, labeled stated.
- **`usual deck`**:
  - `usual deck list` shows the available decks and which ones already have answers.
  - `usual deck run <deck>` asks the questions in chat, one short multiple-choice round, and stores the answers.
  - `usual deck import <answers.jsonl>` takes answers from the web page, to the local database only.
- **Deck files**: `decks/<domain>.json`, with a round id, title, and questions (id, question, options). Ship the first ones:
  - `ios-polish`, seeded from walkie/research/polish/ios-polish-decisions.md;
  - `web-app`, `api-design`, `testing`, `dependencies`, `scope-and-permissions`.
- **Onboarding gap check**: after mining, count evidence per domain. Offer the deck for any empty or thin domain: "I have nothing on how you like UIs. Take the 2-minute iOS deck?" People with no history start there.
- **Conflicts**: if a later reviewed decision goes against a stated answer, `consult` shows both, with dates, as an exception. It never silently picks one.
- **Refresh**: a question whose predictions keep getting corrected gets queued for the next deck round.
- **Web deck on tryusual.com**: the same page as paul.polyfeeds.dev. Answers download as a file, or post to the local Usual via a one-time code, and never stay on the server.

## Not building
- Weighting stated preferences above or below observed behavior with a formula. Both are shown with dates, and the model reasons over them.
- Server-side storage of answers, or accounts on tryusual.com.
- Letting an agent answer a deck on the user's behalf.

## Touches
- `scripts/usual.py`: schema (stated evidence), the `deck` commands, gap counts in `onboard`, and exceptions in `consult`.
- `references/onboarding.md`: the deck step after Learn.
- `decks/*.json`: the new deck files.
- `deploy/` (tryusual.com): the deck page.

## Done when
- [ ] `usual deck import` of walkie/research/polish/deck/answers.jsonl stores 8 stated answers, and `consult` on "Walkie iOS: Titles on list screens" returns the stated "Small inline titles" with its date and source.
- [ ] `usual deck run ios-polish` in a test asks every question once and stores one answer each; a skipped question stores nothing.
- [ ] A reviewed decision contradicting a stated answer makes `consult` return both, marked as an exception.
- [ ] `onboard` reports per-domain evidence counts and names the domains that have a deck but no evidence.
- [ ] An agent can't answer a deck for the user: `deck run` without a confirmed user answer stores nothing (covered by a test).
- [ ] The tryusual.com deck page answers a round and produces an import file; no answers are stored server-side (checked in the server code and by a test).
- [ ] The existing test suite passes.

## Open
- Whether a deck answer becomes stale after N months, or stays until contradicted.
- Where the per-domain gap check draws the line between thin and enough.

---
source: 2026-09-26 jam
