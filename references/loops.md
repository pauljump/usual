# Loops

Keep a useful repeated method, change its inputs, and inspect what happened.
Loops is part of [Usual](https://github.com/pauljump/usual). It works independently
of history import, Choices, and accounts. Python 3.11+ on macOS or Linux is required.

The first release includes one invocable method: **check selected files**. It checks
that each named file exists, is a nonempty regular file, and fits the 10 MiB limit;
computes SHA-256; parses `.json` files; and compares any expected hashes you supply.
This is useful for repeating a bounded artifact check. It does not run a project's
tests or establish that an application is ready to release.

## Install and use

From an inspected Usual source bundle, replace `/absolute/path/to/project` with the
directory you explicitly want to check. Usual home must be outside that directory.

```bash
python3 scripts/usual.py loops create check-files --scope /absolute/path/to/project --file README.md --file package.json
python3 scripts/usual.py loops inspect check-files
python3 scripts/usual.py loops preview check-files
python3 scripts/usual.py loops run check-files --label "Check the current artifacts"
```

Creation installs a JSON routine under `~/.usual/loops/`; it does not execute it.
Preview shows its scope, stable method, and variable inputs without reading the
selected files or writing a run receipt. Run executes the method and prints a
receipt with the actual checks plus paths to private JSON and HTML reports.
A failed file check returns exit code 1; invalid configuration returns 2.

`--home /absolute/private/location` before `loops` uses an isolated Usual home.
No coding-client settings, source files, or original transcripts are changed.
The runtime makes no network calls and invokes no shell commands or project hooks.

## Stable method, variable inputs

The stable method is `file-check-v1`. `inspect` shows its ordered steps. Every
invocation is restricted to the saved directory and explicitly named relative
files. Symlinks, parent traversal, directory inputs, and replaced scope directories
are rejected. Reads are capped at 32 files and 10 MiB per file.

Change the selected files or label for one invocation:

```bash
python3 scripts/usual.py loops again check-files --file README.md --label "Documentation check"
python3 scripts/usual.py loops run check-files --file package.json --expect package.json=REPLACE_WITH_64_HEX_DIGIT_SHA256
```

The second command compares against a hash you actually reviewed; the placeholder
is deliberately invalid. A computed digest alone records identity; a match against
your supplied expected digest tests that expectation. `.json` validation checks
syntax only. Passing these checks is not evidence that application tests passed.

## Inspect, edit, correct, disable, remove

```bash
python3 scripts/usual.py loops list
python3 scripts/usual.py loops edit check-files --file README.md --file package.json --correction "Check the manifest syntax too."
python3 scripts/usual.py loops edit check-files --clear-expect --note "Expected hashes vary by release."
python3 scripts/usual.py loops disable check-files
python3 scripts/usual.py loops enable check-files
python3 scripts/usual.py loops remove check-files
```

Edits preserve prior revisions and unrelated custom JSON fields. Corrections stay
visible. Repeating an identical install is safe; a conflicting install asks you
to inspect or explicitly edit the existing routine. No install silently replaces
your changes. Removal disables the routine and retains its document, revisions,
and receipts; `enable` explicitly restores it.

The JSON file can be edited directly. Change its supported inputs, title, notes,
or enabled state. The executable method remains fixed: changing its method or
steps makes invocation fail. There is no arbitrary-script runner in this release.

Installation and verification are separate. A newly created routine is `not-run`.
Its latest real invocation records `passed` or `failed`. Any routine edit changes
its fingerprint and invalidates that recorded verification for the new version.
Receipts remain historical observations; later source changes require another run.

## From history to a routine

Vibecheck can surface repeated human requests to inspect artifacts. Inspect the
cited requests, scope, exceptions, and uncertainty with your active coding agent.
Choose this routine only if its actual built-in checks fit the current task.
Repetition does not prove a method is correct, that a previous operation succeeded,
or that execution is currently authorized. A historical request to publish does
not permit publication now. Loops never schedules or expands its own scope.

For a different routine, the active agent can help author a separately reviewed
implementation and verification cases. That future work is not an installed
capability of `file-check-v1`.

## Privacy, provenance, verification

Routine documents and receipts contain local paths and may contain private labels,
notes, or corrections. Keep them private. My Usual's allowlisted setup export can
share the selected `loops` module; it excludes private routines, scopes, and receipts.
Evidence shown to a hosted coding agent follows that provider's normal processing.

Usual owns this MIT implementation. Its design adapts the stable-method/variable-input,
correction, and verification concepts from the prior Codex Loops idea and Vibecheck
Loops guide; no private historical source text is bundled. The older
[Vibecheck Loops guide](https://vibecheck.polyfeeds.dev/loops) remains a guide,
not proof that a generated routine is tested.

`python3 -m pytest -q tests/test_collection_loops.py` exercises successful second
invocation with different inputs, malformed JSON, missing and oversized files,
digest mismatch, symlink and scope escapes, configuration preservation, corrections,
disable/removal, receipt privacy, and HTML escaping. These are deterministic local
tests, not live coding-agent behavior tests. Windows execution is not supported by
this method because it requires POSIX directory descriptors and `O_NOFOLLOW`.
