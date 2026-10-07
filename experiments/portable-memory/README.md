# Usual portable-memory connector

The private pilot at **https://testing.polyfeeds.dev** exposes a remote MCP server for Paul:

```text
https://testing.polyfeeds.dev/mcp
```

Connect once with OAuth, then say:

> Add to my Usual.

The assistant extracts your actual choices from the accessible conversation and uploads them directly. Then, in a connected session:

> Use my Usual.

The assistant retrieves relevant decisions for the current task. There is no JSON paste-back step in this connected workflow. The website remains available for inspection, corrections, exclusions, and export. Manual copy-paste prompts are retained under a fallback disclosure for assistants without MCP.

## Named tester links

Coxy and Bradford have independent collections at `/coxy/` and `/bradford/`. Each invitation is a URL with a random private fragment, for example `/coxy/#<private-token>`. The name alone is not a password and reveals no memories. There is no signup form.

Their setup pages display their personal connector addresses:

- Coxy: `https://testing.polyfeeds.dev/coxy/mcp`
- Bradford: `https://testing.polyfeeds.dev/bradford/mcp`

Open the full invitation in the browser, then connect the address shown on that page in the assistant with OAuth. The consent screen identifies the collection. Each profile has its own SQLite database, client registrations, browser cookie, access tokens, and refresh tokens. A token or memory ID from another profile is rejected. Paul's existing root link and connections keep working.

Invitation credentials are loaded through `USUAL_COXY_TOKEN` and `USUAL_BRADFORD_TOKEN` from the fleet vault runner. Databases are `portable-coxy.sqlite3` and `portable-bradford.sqlite3` beside the original database. No secrets belong in this document or source.

## One-time setup

1. Open your full private Usual link in the browser you use to connect your assistant. This establishes a seven-day HttpOnly browser session for the consent page. The bare hostname does not expose your collection.
2. In ChatGPT, enable Developer mode in Settings → Security and login when available. Add a connection from Plugins using the endpoint above. Choose OAuth and dynamic client registration; no client ID or secret needs to be pasted. Availability depends on the account and workspace policy.
3. Approve the Usual consent screen. If this opens in a different browser, enter the original private link or its access code once. Check the displayed assistant and callback before approving.
4. Enable the connection in the conversation. Whether it can be added to an existing chat depends on the host; Usual does not grant access to all previous chats.
5. In Claude or another remote-MCP client, connect the same endpoint with OAuth to use the same collection. Client tool-confirmation controls still apply.

Official integration references: [OpenAI authentication](https://developers.openai.com/plugins/build/auth), [connection testing](https://developers.openai.com/plugins/deploy/connect-chatgpt), [MCP HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Tools and evidence

- `add_to_my_usual`: save up to 12 evidence entries. Explicit human choices become **observed** evidence immediately, not individually reviewed extractions. Inferred patterns stay **pending**. The agent must have a current user request to save and must not invent evidence.
- `use_my_usual`: bounded lexical search over **observed** and **accepted** entries. Returns source, exact quote, situation, exceptions, basis, and status. Pending and excluded entries are never returned. Empty query retrieves a bounded recent set; unmatched topics return no evidence rather than unrelated guesses.
- `exclude_from_my_usual`: exclude specific IDs at the user's request. Stops recall and preserves the record. This is not physical deletion.

Exact normalized duplicates are skipped. Paraphrases and contradictory choices remain separate evidence; no semantic merger is claimed. The host assistant supplies reasoning. No trained user model, background monitoring, external model API, or inference service is used by this server.

Manual imports and restored JSON exports still require review. A direct save never resurrects an excluded duplicate. Review can promote an observed choice or pending inference to accepted. No historical choice grants authority for spending, sharing, publishing, deletion, or credential changes.

## Runtime and deployment

```sh
python3 experiments/portable-memory/app.py
```

Open the printed private local link. The default database is `~/.usual/portable-pilot.sqlite3`, separate from the coding skill. Use `--db /private/path/pilot.sqlite3` for another collection and `--port 8242` for a fixed local port. The server binds only to loopback.

The public origin is configured with `USUAL_PUBLIC_ORIGIN`; the persistent owner capability comes from `USUAL_ACCESS_TOKEN`, supplied only through the fleet vault runner. See `deploy/portable-memory.json`. The PM2 process is `usual-portable`, behind the existing Cloudflare tunnel. The main tryusual.com site and source download are unchanged.

Each profile reuses Usual's SQLite permissions, transaction handling, event ledger, secret scrubber, and lexical term extraction. OAuth client registrations and hashed token records persist in that profile's private database. Credentials never enter access logs or source.

## Authorization boundaries

This is an **invite-only pilot with isolated named profiles**, not an open account service. Each consented client sees only the profile that authorized it. Keep each full private invitation private; possession grants access to that profile. Profiles cannot use the same database or invitation token.

The custom pilot authorization service supports DCR public clients, exact registered redirect matching, S256 PKCE, resource and issuer binding, scope checks, explicit browser consent, two-minute single-use authorization codes, one-hour opaque access tokens, and rotating 30-day refresh tokens. Tokens are stored only as hashes. OAuth code exchange and refresh consumption are atomic. Origin checks protect HTTP requests; same-origin POST is required for consent; global OAuth request and client-registration bounds limit untrusted registration traffic.

MCP discovery exposes tool descriptions, not memory data. Tools require scoped OAuth access tokens. The owner link can administer the review UI but is not an MCP access token. The browser's cookie is used for consent only, never as a substitute for tool authorization. Streamable HTTP is stateless, uses JSON responses, supports protocol versions 2025-03-26, 2025-06-18 and 2025-11-25, and returns 405 for an authenticated GET stream request.

Before broad rollout, replace pilot owner-link login with established identity infrastructure, add self-service account management and connection revocation UI, and test more clients. Neither a custom OAuth implementation nor a passing local test establishes production security or ChatGPT account compatibility.

## Validation

```sh
python3 -m pytest -q tests/test_portable_memory.py tests/test_portable_connector.py tests/test_portable_profiles.py
python3 -m pytest -q
```

Tests cover persistence, review gates, direct saves, duplicate/exclusion behavior, context preservation, redaction, atomic validation, scope denial, PKCE, callback/resource/client binding, code replay, refresh rotation, expiration, restart persistence, metadata and consent. Run `python3 experiments/portable-memory/verify_connector.py` in a test environment with the official `mcp` Python SDK installed to reproduce the synthetic HTTP round trip, including dynamic registration, browser consent and token exchange. The runtime itself remains standard-library-only. No live LLM calls were made. Actual attachment inside the user's ChatGPT account still needs its one-time setup; do not report that as completed by protocol tests.

To test value, use three conversations per person, hold back decisions, and compare Usual with no added profile and a simple about-me document. Keep the model/task consistent, randomize output order, collect corrections and preferences, then observe voluntary reuse. No human prediction-accuracy results are claimed.

### Named Paul link

`/paul/#<owner-token>` opens the existing owner collection. Its API, browser cookie, and OAuth issuer remain at the root, so existing memories and assistant connections continue to work. Coxy and Bradford keep their isolated profiles. The page leads with one-time setup and the two chat commands; manual transfers are expandable.


## Thinking-profile demo (current landing page)

The root and named private pages now lead with **Learn how I think** and **Think like me**.
The source assistant analyzes a selected thread into `usual.thinking.v1`: source plus up to
12 conditional rules with context, tradeoff, exact supporting quote, exceptions and
explicit/inferred basis. This does not mine other threads or prove predictive accuracy.

- `POST /api/analysis`: validates and atomically stores an analysis. Accepts the owner token
  or a separate HMAC-derived submission capability. The learning instructions support direct
  upload when the assistant has an HTTP tool, otherwise a percent-encoded fragment review link.
- `/submit#key=…&packet=…`: previews the analysis; GET never saves. The user presses Add to POST.
  Large or malformed generated links fall back to a JSON file upload on the owner page.
- `GET /api/thinking`: owner-only profile, instructions, and read-only URL.
- `GET /thinking/<read-capability>`: plain text profile without JavaScript, cookies or login.
  The path capability is read-only and profile-specific; never use the owner token here.
- `POST /api/analysis-hide`: owner-only removal from the active profile, retaining the source.
- `/library`: preserves the previous memory review UI and OAuth connection setup.

Routes have the invited user's prefix for Coxy and Bradford; Paul retains root API routes.
The compiler groups case/whitespace-normalized identical rules and preserves every source's
context and conflicts. It does **not** run semantic synthesis or a model API. Existing accepted
or observed legacy decisions are included, with their original basis. Inferences remain
hypotheses even after the user submits the packet. Duplicate hidden analyses stay hidden.

Read links disclose the profile to anyone holding them, including the assistant receiving the
link. Responses are no-store/noindex; application access logging is disabled. URL capabilities
may still appear in browser/provider infrastructure. They are distinct from edit credentials.
The browser tests validate synthetic submission/retrieval, not ChatGPT's ability to generate
correctly encoded links or fetch the host on every account. For a blocked lookup, download
and attach the profile. No paid inference was used. Test actual judgment by holding out a
human decision and comparing a fresh assistant with and without the profile.
