# Six-item local release — implementation complete

Branch: `build/usual-six-20260912`. This checkout is isolated and non-canonical. The canonical Usual checkout and public service remain unchanged. Publication is pending review and explicit approval.

## Completed behavior

- Versioned six-item catalog drives CLI, website pages, agent-readable instructions and generated README menu.
- Vibecheck/Recall use selected Codex/Claude native JSONL sources, deterministic parsing, role/metadata filtering, fork deduplication, scoped citations, dated context, exceptions, uncertainty, empty results and a validated current-agent handoff. Findings can be corrected or dismissed.
- Choices retains existing invocation, database, ledger, contextual retrieval, modes, review and migration behavior.
- Loops creates an editable, scope-enforced `file-check-v1` routine with variable filenames, hashes and labels. It previews/runs/again, records real checks and receipts, preserves corrections and revisions, and supports disable/removal.
- Pop installs independently, preserves unrelated instructions, detects conflicting settings/edits, supports repeat/update/disable/removal and distinguishes installed state from scripted format verification.
- Escape installs a pinned, attributed MIT asset and license with an explicit website snippet. Its generic-guide copy fix is a recorded one-line distribution patch. Upstream stays canonical.
- My Usual persists tool selection, configuration, scope, installation and verification separately from history. JSON/private HTML inspection and receipts are usable locally.
- Explicitly reviewed setup export uses a strict positive allowlist. A separate recipient can inspect/adapt/import/install/use it without author evidence. Private routines are not exported in this version.
- Synthetic public walkthrough, six individual pages, copyable local handoff, JSON/HTML setup cards, social artwork, contribution example and catalog validation are complete.

## Evidence and commands

- Original preserved baseline: `185 passed, 5 skipped`.
- Final documented suite: `python3 -m pytest -q` → **276 passed, 5 skipped**. Existing skipped experimental checks are not claimed as evidence.
- Original Transcript Mine adapter/index tests: **15 passed**, read-only against its source root.
- `python3 scripts/validate_catalog.py` → six valid items and matching README; the standalone contributor example validates and runs.
- `python3 scripts/run_flagship.py --out NEW_EMPTY_DIRECTORY` → discovery, exact citations and exception, selected routine, two actual invocations, receipts, sanitized recipe, separate recipient Pop install/use. Final public projection matched across independently isolated homes.
- `python3 scripts/build_release.py` → source-only allowlist and SHA-256 manifest; all members inspected and hashes verified. No private history, account paths, research, databases, experiments or nested bundles were included. Legacy Choices replay IDs/timestamps make each bundle hash specific to that build; the flagship projection itself is reproducible.
- Source ZIP installation was checked under two isolated client homes after moving the source away: existing Choices doctor, menu, Recall, Vibecheck, flagship, Loops, Pop, Escape and recipe export remained usable.
- Public route/content/security tests pass. Local Chromium 152 at 1440×1000 and 390×844: 25 scripted screenshots plus two legacy Pop captures. Checked citations/exceptions, routine/receipt, recipe download/HTML, keyboard navigation, copy success/fallback, empty/loading/error/retry, all six pages, no horizontal overflow, forced Escape widget, and no external browser requests.
- Preservation audit: all **300** recorded canonical file hashes match the starting state; canonical Git status is unchanged. No stash/reset, source deletion, publication, public-service restart, routing change or paid-provider call occurred.
- Portfolio scan completed: 223 projects, 74 ideas; no changed canonical record. The isolated contract and portfolio integration note are prepared for the later approved integration.

## Run locally

```sh
python3 scripts/usual.py menu
python3 scripts/usual.py pop use https://example.com --browser both
python3 scripts/run_flagship.py --out /tmp/usual-flagship
PYTHONPATH=src python3 -m usual.server --autopilot-public --host 127.0.0.1 --port 8876
```

Open `http://127.0.0.1:8876/`. Open the new flagship output's `my-usual.private.html` to inspect local state; `setup.html` is the sanitized card. Detailed browser reproduction is in `references/website.md`.

## Limits and outstanding publication work

The collection runtime targets macOS/Linux POSIX and was checked on macOS; other OS/client adapters are not validated. Fresh live Codex/Claude sessions and physical-device browser handoff remain unverified in this build. Scripted formats and synthetic user agents do not prove them. No paid-provider verification was required for the implemented local acceptance flow.

Vibecheck finds bounded repetition candidates; the current agent supplies interpretation. Structural citation validation is not semantic accuracy proof. The first Loops method checks files only; it does not generate arbitrary shell automation or establish application correctness. Sharing carries selected modules and reviewed safe options, not private routine bodies. Escape still needs explicit website integration and device checks; iOS escape is guided.

The preserved-input parent commit records relevant inherited website inputs. Other inherited untracked experiments/media remain copied on disk, are recorded in the private baseline, and are excluded from this release. The implementation diff is reviewable separately from those inputs. The private review packet contains exact local evidence paths, preservation hashes, final bundle hash and an application-only patch.

No local implementation remains open. After publication approval, recheck the dirty canonical baseline, apply only the reviewed patch, synchronize the named owner repository, and use the declared canonical Cloudflare Tunnel/fleet-vault deployment process. Reconcile new canonical edits rather than overwriting them. Do not route public traffic to this isolated checkout.
