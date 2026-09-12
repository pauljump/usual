# My Usual and independent installation

Source: https://github.com/pauljump/usual

Collection commands accept `--home PRIVATE_DIRECTORY` before the command (default `~/.usual`). This is a private **data** directory; `install.py --home` and `pop install --client-home` instead identify an isolated **client account home**. Choices retains its existing independent `--db` option. Collection commands never create a Choices database.

`menu [ID]` prints the versioned catalog. `setup install ID --scope DIRECTORY` saves an enabled selection, configuration, local artifact and installation state. For Vibecheck, Recall, Loops and Choices the local runtime is already present: installation registers that usable command and chosen scope; it does not claim an agent loaded it. Scope is descriptive for Choices and Recall; their explicit command scopes continue to control each invocation. Loops routines enforce their own selected filesystem scope.

`setup inspect` prints state; `--format html --out NEW_FILE` writes a private inspection. The inspected setup includes editable routine details and the receipt from their last matching revision. Evidence/findings stay in separate objects. `setup receipts` lists installation/use receipts. Files are private local artifacts, not a public server API.

`setup configure ID --scope DIRECTORY [--config JSON]` changes an inactive configuration and invalidates its previous verification. For active Pop use `pop install --client CLIENT --browser chrome|safari|both [--project DIRECTORY]`: it replaces only the unchanged managed block and preserves all surrounding instructions. Global targets are Codex's `.codex/AGENTS.md` or Claude's `.claude/CLAUDE.md`; `--client-home` isolates testing. No permission settings change. Unknown clients, conflicting markers, legacy unmarked rules or modified managed content fail without overwriting. The agent can inspect those differences and reconcile them under the current task.

`pop use URL [--browser BROWSER]` and `pop verify URL` run the local formatter and check an active managed rule. A receipt can say `scripted-format-checked`; it never becomes live-agent/device verification. A repeat installation preserves a matching verification; a changed rule resets it. A direct `pop use --browser` can run without installation or history.

`setup disable pop` removes only an unchanged owned block. `setup remove pop` additionally removes it from the selected setup. Both preserve the instruction file, surrounding changes and all prior receipts. Other items retain their source and private data. Loops disable also disables its routines; routine removal retains revisions and receipts. Escape's local asset is preserved; remove its explicitly installed script tag from the website to stop that widget. No website is deployed by these commands.

A disabled collection item does not revoke access to its standalone Python source. Explicit individual commands remain possible. This is a setup manager, not an operating-system execution sandbox.

`setup export --reviewed` emits only the selected enabled modules' IDs and compatible versions. No configuration is included by default. `--include-config pop.browser` adds only that reviewed enum. JSON and HTML/card exports use the same validated object. Existing output files are never overwritten. Private routine bodies, scope, client targets, dates, filenames, preferences and permissions do not travel.

`setup import FILE` validates and shows the exact recipe. `--reviewed --scope DIRECTORY` saves uninstalled selections for the recipient. An import with unknown fields, versions, duplicates, executable configuration or conflicts fails before changing the setup. Installation is a separate command; imported recipes cannot execute code.

The portable skill installer keeps backups outside skill discovery, retains unrelated added files and refuses changes to modified owned files. Its hash manifest provides preservation across future upgrades; known previous-source hashes support an unmodified pre-collection installation. If an older or customized file cannot be recognized, inspect the reported conflict and reconcile it explicitly. No database is replaced by an installer update.
