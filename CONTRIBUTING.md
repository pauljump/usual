# Contributing to Usual

Start with one complete small improvement: a supported adapter, a reproducible installation fix, a sanitized routine, or an independently useful tool. Open an issue or pull request at https://github.com/pauljump/usual.

The menu is `src/usual/catalog.json`. Each item needs a stable ID, clear benefit, maintainer, source/version/license, honest maturity, tested environments, explicit configuration, install/use/remove paths, storage/network behavior and an example. The website reads that catalog directly; the README table is generated from it.

Try the minimal example:

```sh
python3 examples/catalog/hello.py
python3 scripts/validate_catalog.py --catalog examples/catalog/item.json
```

To propose an item, adapt that example, implement its observable result and preservation/removal behavior, add useful synthetic tests, and document the actual environment tested. A valid manifest alone does not earn a maintained menu slot. Third-party source must include its license, a reviewed revision and an update strategy.

```sh
python3 scripts/validate_catalog.py --write-readme
python3 -m pytest -q
python3 scripts/build_release.py --out /tmp/usual-release-review
```

Never use real transcripts or private project names in public fixtures. Keep local state outside the repository. Setup export uses an allowlist; adding configuration to a catalog does not automatically make it safe to share. No inference API, background collection or telemetry may appear as an incidental dependency.

Preserve existing Choices commands and data semantics. Distinguish fixture tests, scripted clients and real live-agent/device checks. A passing test is evidence for its check only. Document limitations plainly.
