# Turrii jam room

`https://tryusual.com/turrii` is a private, password-gated product workshop. It is
served by the existing `usual-web` runtime, but it is not part of Usual's public
product menu or sitemap.

The workshop follows the Last Bump jam pattern:

- two shared jam slots;
- four rounds, each requiring an explicit human contribution;
- two or three selected Teek lenses;
- a frozen Turrii context and evidence snapshot for each jam;
- no automatic model retries or autonomous continuation;
- a shared server-side archive outside the repository.

Runtime configuration comes from the portfolio vault:

- `TURRII_JAM_PASSWORD`
- `TURRII_ANTHROPIC_API_KEY`
- optional `TURRII_JAM_DATA_FILE`

The password and provider credential must never be committed. The default archive
is `~/.usual/turrii-jam/jams.json` with owner-only permissions.

The model is invoked only after an authenticated user explicitly starts or
continues a jam. Tests use a fake generator and must not make provider calls.

