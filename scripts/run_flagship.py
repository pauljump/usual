#!/usr/bin/env python3
"""Reproduce the complete local loop with synthetic sources and isolated homes.

The public JSON is a deliberately bounded projection. The private run directory
contains full source pointers, the editable routine, state and actual receipts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from usual import collection, history, loops


def run_flagship(output):
    output = Path(output).resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError("Choose a new empty output directory; previous receipts are preserved.")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    project, sources, home = output / "project", output / "history", output / "private"
    project.mkdir()
    sources.mkdir()
    (project / "README.md").write_text("# Synthetic release\n\nA local fixture for Usual's file-check routine.\n")
    (project / "manifest.json").write_text('{"name":"synthetic-release","version":"1.0.0"}\n')
    for source in sorted((ROOT / "demo/fixtures").glob("sample-flagship-*.jsonl")):
        shutil.copy2(source, sources / source.name)
    before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in project.iterdir()}
    source_before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources.iterdir()}
    report = history.scan(home, [str(sources)])
    candidate = next(f for f in report["findings"] if f["next_action"]["item"] == "loops")
    # This is a checked-in interpretation of public fixtures, replayed through
    # the same validator the current agent uses for a private report.
    interpreted = {"findings": [{
        "title": "Make the release file check one reusable routine",
        "observation": "Two independent human requests specify the same release-review method: check README.md and manifest.json, nonempty files, valid JSON and recorded hashes. A later note-only handoff explicitly skips it.",
        "citations": candidate["citations"], "exceptions": candidate["exceptions"],
        "uncertainty": "Useful for the selected release-review scope; not a general preference or a release approval. File checks cannot establish that application tests passed. The note-only exception remains excluded.",
        "next_action": {"item": "loops", "action": "Inspect and invoke file-check-v1 for this synthetic release directory only, with explicit filenames and a variable run label."}}]}
    report = history.import_report(home, report["id"], interpreted)
    finding = report["findings"][0]
    collection.install_tool(home, "loops", project)
    routine = loops.create(home, "release-files", project, required=["README.md", "manifest.json"],
                           expected_sha256=before, title="Check the release files")
    preview = loops.invoke(home, "release-files", inputs={"label": "Release review 1"}, preview=True)
    receipt = loops.invoke(home, "release-files", inputs={"label": "Release review 1"})
    if receipt["verification"]["status"] != "passed":
        raise AssertionError("Flagship routine did not pass")
    again = loops.invoke(home, "release-files", inputs={"label": "Release review 2"})
    assert again["verification"]["status"] == "passed"
    # Pop demonstrates the independent entry path, with an explicit fixture
    # browser selection. It is not inferred from a generic Markdown preference.
    pop = collection.install_pop(home, "codex", output / "client", "both")
    formatted = collection.verify_pop(home, "https://example.com/release?view=review#files")
    recipe = collection.export_recipe(home, ["pop.browser"], reviewed=True)
    recipient_project = output / "recipient-project"
    recipient_project.mkdir()
    recipient_home = output / "recipient-private"
    imported = collection.import_recipe(recipient_home, recipe, recipient_project, reviewed=True)
    recipient_pop = collection.install_tool(recipient_home, "pop", recipient_project)
    recipient_result = collection.verify_pop(recipient_home, "https://example.com/recipient")
    assert recipient_pop["item"]["config"] == {"browser": "both"}
    assert all(hashlib.sha256((project / name).read_bytes()).hexdigest() == value for name, value in before.items())
    assert all(hashlib.sha256((sources / name).read_bytes()).hexdigest() == value for name, value in source_before.items())
    empty_sources = output / "empty-history"
    empty_sources.mkdir()
    empty = history.scan(output / "empty-private", [str(empty_sources)])
    assert empty["findings"] == []
    packet = {e["id"]: e for e in report["evidence"]}
    def public_source(citation):
        evidence = packet[citation]
        name = Path(evidence["source"]["path"]).name
        if name not in source_before:
            raise ValueError("Only declared synthetic fixture sources can enter the public demonstration.")
        return {"quote": evidence["quote"], "date": evidence["date"], "file": name,
                "line": evidence["source"]["line"], "context": evidence["context"]}
    public = {
        "schema_version": 1, "mode": "synthetic-fixture-replay",
        "sample_label": "Synthetic example · real local code paths · no live model calls",
        "scope_summary": "3 selected synthetic history files · 3 sessions · September 1–3, 2026",
        "finding": {"title": finding["title"], "interpretation": finding["observation"],
                    "sources": [public_source(v) for v in finding["citations"]],
                    "scope": "This synthetic release review only. The note-only handoff is excluded.",
                    "exceptions": [public_source(v) for v in finding["exceptions"]],
                    "uncertainty": finding["uncertainty"]},
        "action": {"title": "Use the release file check", "command": "python3 scripts/usual.py loops run release-files --label 'Release review 2'",
                   "steps": routine["routine"]["steps"],
                   "variables": ["Selected local directory", "Explicit filenames", "Expected SHA-256 values", "Run label"]},
        "receipt": {"outcome": "Both selected files passed the scoped checks. The routine ran again with a new label.",
                    "checks": receipt["checks"],
                    "limitation": "Deterministic file checks only. This does not verify application behavior, approve a release, or prove live-agent behavior.",
                    "verification": receipt["verification"]},
        "recipe": recipe,
        "empty": {"findings": [], "reason": empty["empty_reason"]},
        "pop_example": formatted["formatted"],
        "recipient": {"outcome": "Recipe imported into a separate home; Pop installed and formatter checks passed.", "installed": True,
                      "verification": "scripted-format-checked", "live_agent": False},
        "repository": collection.REPOSITORY}
    # A positive public schema: no wholesale report/state serialization.
    serialized = json.dumps(public, indent=2)
    if str(output) in serialized or any(v in serialized for v in [str(Path.home()), 'judgment.sqlite3', 'managed_sha256']):
        raise AssertionError("Private execution state leaked into the public projection")
    (output / "flagship.json").write_text(serialized + "\n")
    (output / "setup.json").write_text(json.dumps(recipe, indent=2) + "\n")
    (output / "setup.html").write_text(collection.recipe_html(recipe))
    (output / "my-usual.private.html").write_text(collection.setup_html(home))
    collection.write_json(output / "execution.private.json", {"report": report, "routine": routine,
        "preview": preview, "receipt": receipt, "again": again, "pop": pop, "formatted": formatted,
        "recipient": imported, "recipient_result": recipient_result, "sources_preserved": True})
    return public


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    run_flagship(args.out)
    print(json.dumps({"out": str(args.out.resolve()), "public_demo": str(args.out.resolve() / 'flagship.json'),
                      "private_inspection": str(args.out.resolve() / 'my-usual.private.html'),
                      "result": "Discovery → cited finding → selected routine → use → receipt → recipe → recipient use passed."}, indent=2))
