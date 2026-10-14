# Usual project contract

- Product: **Usual**. Canonical repository: `https://github.com/pauljump/usual`.
- Promise: **Your AI, how you like it.** The menu is Vibecheck, Choices, Recall, Loops, Pop, Escape and Where.
- Canonical local root: `/Users/mini-home/projects/usual/core`.
- `src/usual/` is the runtime; `SKILL.md` and `install.py` are the portable agent skill.
- `src/usual/catalog.json` drives the public menu and generated README table. Validate with `python3 scripts/validate_catalog.py`; regenerate the table with `--write-readme`.
- My Usual stores selected tools/configuration/scopes separately from private historical evidence. Explicit collection commands use `--home`; existing Choices keeps `--db` and its previous database semantics.
- Reproduce discovery through recipient use with `python3 scripts/run_flagship.py --out /tmp/usual-flagship` (a new empty directory). Public examples use synthetic fixtures only.
- Recall uses the maintained adapted core in `src/usual/recall_core`; preserve its MIT notice and source provenance. Escape is pinned upstream with an explicit local patch, not a repository migration.
- Recall MCP (`src/usual/mcp_server.py`, launcher `scripts/usual-mcp.py`) is a stdlib stdio MCP server over the same private index (`~/.usual/recall/`). It re-indexes changed transcripts under its explicit `--source` roots before queries. Registered for Claude Code (user scope) and Codex (`~/.codex/config.toml`) as `usual-recall`.
- Learn (`src/usual/learn*.py`, [references/learn.md](references/learn.md)) is the evidence → assessment → reviewed-playbook loop behind `usual learn` and `usual playbook`. Its store is private (`~/.usual/learning/`); only user reviews promote a learning or approve a playbook, and it is off the public menu. Project record: [docs/learn/README.md](docs/learn/README.md).
- Where (`src/usual/where.py`) is a single stdlib file that also ships standalone at `tryusual.com/where.py`; keep it free of package imports so the download works on its own. It reads Claude Code and Codex transcripts read-only, caches to `~/.usual/where/`, and serves its board on 127.0.0.1 with a one-time token. Public page `where.html`, agent guide `public/where.md`; regenerate the demo board and share images with `scripts/where/render.sh` (synthetic sessions only).
- The first Loops method is scoped, read-only `file-check-v1`; repetition does not authorize execution or establish a good procedure.
- Run `python3 -m pytest -q` from the root. Tests discover only the active product and its demo, not archived research.
- Build public downloads with `python3 scripts/build_release.py`. The allowlist excludes private data and research artifacts.
- Public deployment is declared in `deploy/web.json`; use the control-plane fleet registry and vault runner.
- The password-gated Turrii workshop lives at `/turrii/` inside the public server but is not a public Usual menu item. Its product contract and frozen context are in `products/turrii-jam/`; its archive lives outside the repository. Provider calls require an authenticated, explicit human contribution and must never be exercised by deployment checks.
- Bait (`src/usual/bait/bait.js`) is a standalone website tool at `/bait/`, not a menu item. It runs as the `usual-bait` Cloudflare Worker on every zone in `deploy/bait-worker.json` and serves the shared leaderboard at `tryusual.com/bait/live/`. Deploy with `node scripts/bait/deploy.mjs` (dry run) then `--apply`; `BAIT_SECRET` lives in `/Users/mini-home/.secrets/monorepo.env`. Public counts must be real: simulated trips (`backfill.mjs --simulate-trips`) are local previews only.
- Bait continuation state, latest traffic evidence and outstanding Shopify installation are in [STATE.md](src/usual/bait/STATE.md).
- Bait tarpit generation, measurement semantics, quota use and verification are documented in [TARPIT.md](src/usual/bait/TARPIT.md).
- Bait's traffic-driven learning loop, origin-404 gating, local report and resource limits are documented in [LEARNING.md](src/usual/bait/LEARNING.md).
- Bait Lab is the local downloadable verification-test experiment in `products/bait-lab/`; [BUSINESS.md](products/bait-lab/BUSINESS.md) owns the offer, evidence, launch gates and distribution decision. Public assets remain disabled until `USUAL_BAIT_LAB_PUBLIC_DIR` is explicitly configured; paid delivery files are never web assets.
- Shopify Bait is a native app package at `apps/bait-shopify/`; its [product/runtime contract](apps/bait-shopify/README.md) defines proxy-only coverage, private observations, tests and the published development backend and pending store installation. It is not part of the existing Bait Worker deployment.
- `archive/` preserves the original Itchy research and intermediate experiments. These are historical sources, not current product instructions or validated Usual accuracy results.
- Keep old human decision records intact during migrations. Runtime data belongs outside this repository.

See [README.md](README.md), [runtime semantics](references/runtime.md), and [migration](references/migration.md).
