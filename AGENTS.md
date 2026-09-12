# Usual project contract

- Product: **Usual**. Canonical repository: `https://github.com/pauljump/usual`.
- Promise: **Your AI, how you like it.** The initial menu is Vibecheck, Choices, Recall, Loops, Pop and Escape.
- Canonical local root: `/Users/mini-home/projects/itchy`.
- `src/usual/` is the runtime; `SKILL.md` and `install.py` are the portable agent skill.
- `src/usual/catalog.json` drives the public menu and generated README table. Validate with `python3 scripts/validate_catalog.py`; regenerate the table with `--write-readme`.
- My Usual stores selected tools/configuration/scopes separately from private historical evidence. Explicit collection commands use `--home`; existing Choices keeps `--db` and its previous database semantics.
- Reproduce discovery through recipient use with `python3 scripts/run_flagship.py --out /tmp/usual-flagship` (a new empty directory). Public examples use synthetic fixtures only.
- Recall uses the maintained adapted core in `src/usual/recall_core`; preserve its MIT notice and source provenance. Escape is pinned upstream with an explicit local patch, not a repository migration.
- The first Loops method is scoped, read-only `file-check-v1`; repetition does not authorize execution or establish a good procedure.
- Run `python3 -m pytest -q` from the root. Tests discover only the active product and its demo, not archived research.
- Build public downloads with `python3 scripts/build_release.py`. The allowlist excludes private data and research artifacts.
- Public deployment is declared in `deploy/web.json`; use the control-plane fleet registry and vault runner.
- `archive/` preserves the original Itchy research and intermediate experiments. These are historical sources, not current product instructions or validated Usual accuracy results.
- Keep old human decision records intact during migrations. Runtime data belongs outside this repository.

See [README.md](README.md), [runtime semantics](references/runtime.md), and [migration](references/migration.md).
