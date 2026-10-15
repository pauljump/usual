# Turrii jam room

`https://tryusual.com/turrii` is a private, password-gated product workshop. It is
served by the existing `usual-web` runtime, but it is not part of Usual's public
product menu or sitemap.

The workshop follows the Last Bump jam pattern:

- two shared jam slots;
- four rounds, each requiring an explicit human contribution;
- General jam selected by default, with optional focused categories;
- version 2 named simulated profile replies in conversation order, two passes per exchange, followed by a required human turn; a separate summary only after the fourth human contribution;
- server-validated speaker order and summary timing; invalid output does not advance; legacy records remain readable in their original format;
- two or three selected Teek lenses;
- a frozen Turrii context and evidence snapshot for each jam;
- no automatic model retries or autonomous continuation;
- a shared server-side archive outside the repository.

The opening is one freeform brain dump (12–4,000 characters), not a structured
decision brief. The facilitator identifies themes and uncertainty, asks a focused
follow-up, and never turns rough thoughts into commitments. Later human turns
remain required.

Runtime configuration comes from the portfolio vault:

- `TURRII_JAM_PASSWORD`
- `TURRII_ANTHROPIC_API_KEY`
- optional `TURRII_JAM_DATA_FILE`

The password and provider credential must never be committed. The default archive
is `~/.usual/turrii-jam/jams.json` with owner-only permissions.

The model is invoked only after an authenticated user explicitly starts or
continues a jam. Tests use a fake generator and must not make provider calls.

Replies include short exact source wording inline where available, not internal
path citations. Research summaries are not presented as original customer quotes.
A versioned presentation directive applies to future replies in ongoing jams too;
each turn records it and its effective prompt hash. Frozen context and historical
replies are unchanged. The shared engine applies this to Teek rooms as well.
