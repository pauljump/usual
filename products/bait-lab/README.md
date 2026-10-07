# Bait Lab 0.1

A small regression kit for developers who own a credential-verification adapter.
Test whether your code confuses a response with proof that a credential works.

Python 3.11+, standard library only. No installation, account, API key, model,
Docker image, provider request or persistent service required.

```sh
python3 lab.py demo
python3 lab.py run -- python3 examples/validator.py reference
```

The demo compares two examples supplied with the kit: a deliberately naive HTTP
status check and a reference implementation of the **lab protocol**. It does not
test or score TruffleHog, GitGuardian or any other external product.

## Use your own code

Write an executable adapter. For each case the runner starts a new process, writes
one JSON challenge to stdin, and reads one JSON object from stdout:

```json
{"verdict":"unknown"}
```

Allowed results: `accepted`, `rejected`, `unknown`. Use stderr for diagnostics.
Your adapter receives `url`, `method`, `credential`, `invalidControl`,
`authorityAllowed`, `protocol`, and `context`. See `examples/validator.py` for a
complete dependency-free example. Invoke your existing verification function in
that adapter; do not copy the reference and call its score your product's score.

```sh
python3 lab.py run -- python3 /path/to/your_adapter.py > result.json
```

Exit 0 means every case passed; 1 means a wrong/missing answer; 2 means invalid
input. Each adapter invocation has a ten-second timeout. An adapter is code you
choose to execute, not sandboxed by the runner. Only use your own trusted adapter.
The runner and included examples make no external requests. Your adapter must
also stay on the supplied loopback URL. Do not send fixture credentials to vendors.

For interactive debugging: `python3 lab.py serve --port 8769`. It prints the
challenge manifest and listens only on `127.0.0.1`. Ctrl-C stops it. Routes outside
the case manifest return 404. No requests or credential bodies are saved.

## What the verdicts mean

`accepted` means the configured **synthetic lab authority** authenticated this
credential under the declared protocol and rejected the invalid control.
`rejected` means the authority explicitly rejected it. `unknown` means neither
claim is supported. An untrusted endpoint cannot verify a real provider's key.

The lab principal protocol is intentionally small: a successful body has
`authenticated: true` and a nonempty `principal`; explicit denial has
`authenticated: false` or HTTP 401. HTTP 429/503 and redirects are inconclusive
here. Providers differ: do not transplant these status rules into production
without the provider's contract. `authorityAllowed` models your configured trust
boundary, not a network discovery mechanism. There is no TLS/DNS emulation.

The eight-day case models **replaying a cached observation**, not a fresh provider
verification. Its cache-age context is part of the exercise. For a real integration,
map that context into your own clock/cache controls.

## Cases and provenance

The full pack has 12 cases. The free sample has three and uses the same runner.
`cases.json` is the inspectable answer key and response specification. This is a
regression pack, not a hidden benchmark. Hardcoding IDs defeats its purpose.

Git-remote replay, Redis-at-login and delayed reuse are inspired by Bait's observed
traffic. The model-list case comes from Bait's local imitation implementation.
The remaining cases are deliberate engineering controls. **All HTTP responses,
credentials and case scenarios in this kit are synthetic.** The source snapshots
do not contain enough response evidence to replay a real client's complete session.
See `FIELD-NOTES.md` for the exact observational boundary.

An all-unknown implementation fails the positive and negative controls. A 12/12
score proves coverage of these 12 cases only. It does not prove that a tool is
secure, handles every provider, or caught a real attacker.

## CI and troubleshooting

Run the command above after checkout in CI with Python installed. No dependencies
need fetching. Local sockets must be permitted. Nonzero exit fails the step.
`adapterErrors` and per-case `reason` explain failures. Never upload real secrets
in issue reports. Include only the case ID, Python/OS version and sanitized error.

Run `python3 -m unittest discover -s tests -v` to verify the supplied kit.
No telemetry or automatic updates. Version 0.1 is a one-time downloadable release;
future provider integrations, updates, service levels and support subscriptions
are not included or promised. Code is MIT licensed; see `LICENSE`.
