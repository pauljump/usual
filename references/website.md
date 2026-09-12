# Public collection and local browser verification

The public collection is a read-only Python standard-library server. Its six-item
menu, individual tool pages, and agent-readable instructions use
`src/usual/catalog.json`. `src/usual/website.py` renders catalog content with HTML
escaping. The public handler never opens the local setup, Recall index, Choices
database, or transcript sources.

From an inspected checkout:

```sh
python3 scripts/build_release.py
PYTHONPATH=src python3 -m usual.server --autopilot-public --host 127.0.0.1 --port 8876
```

Open `http://127.0.0.1:8876/`. The server exposes only explicit packaged assets and
catalog routes. The homepage’s interactive example reads `/flagship.json`, generated
through the real local CLI by `scripts/run_flagship.py`. Every scene is a labeled
recording. Buttons reveal the recorded finding, scope, exception, routine, receipt,
and sanitized recipe; they do not execute a visitor’s agent or access local files.
The handoff prompt is the explicit bridge to the user’s existing coding session.

## Browser checks

The optional development harness requires an existing Playwright installation and
local Chromium. It does not install dependencies or download a browser. Set
`NODE_PATH` when Playwright is not in the current Node module resolution path, and
`USUAL_BROWSER_EXECUTABLE` to use an existing Chrome/Chromium executable.

```sh
node scripts/verify_website.cjs http://127.0.0.1:8876 /tmp/usual-site-evidence
```

The harness only accepts a loopback origin and blocks requests to other origins.
It checks all six pages at desktop and mobile sizes, the complete recorded loop,
cited evidence and exceptions, the thin-history result, actual network-loading and
failure states, retry, copy and manual-copy fallback, a recipe download, the
standalone shareable HTML card, keyboard skip navigation, horizontal overflow, and
the forced Escape widget. It emits screenshots and a machine-readable report.

The forced Escape page demonstrates the interface in a normal browser. Scripted
Chromium and synthetic user agents do not establish real in-app-browser behavior
or fresh live-agent support. Record those checks separately.

## Compatibility

- `/pop` redirects to `/pop/`; `/pop/install` stays plain text for coding agents.
- The six detailed pages live at `/menu/{id}/`. Top-level aliases are available for
  Vibecheck, Choices, Recall, Loops, and Escape; the existing Pop page remains.
- `/{id}/install` and `/{id}/use` are agent-readable catalog instructions. Pop's
  longstanding standalone install document retains its short URL.
- `/learn.md`, existing memory/installation/privacy guides, the recorded reading-list
  app, and the earlier interactive demo remain available.
- The earlier Choices homepage is preserved at `/choices/legacy/`.
- `/example-setup.json` and `/example-setup.html` contain only the generated
  allowlisted recipe. `/catalog.json` is the same catalog as the runtime.
- No public setup API, private corpus endpoint, or transcript upload is exposed.

## Artwork and privacy

The collection uses local system fonts and no third-party browser scripts. Its new
1200×630 social preview is editable SVG at
`src/usual/public/collection-og.svg`, with a corresponding checked-in PNG. Regenerate
the PNG with a locally installed SVG renderer (for example Sharp); check dimensions
and inspect the result before replacing it. Legacy artwork is retained separately.

The hosting layer and older pages have existing visit analytics. The private CLI
has no telemetry. Reading excerpts with a hosted coding agent uses that provider’s
normal processing and usage; local storage does not make model inference offline.

Source and contributions: <https://github.com/pauljump/usual>.
