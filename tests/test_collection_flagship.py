"""Acceptance coverage through the public CLI and the actual private artifacts."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from usual.collection import validate_recipe

ROOT = Path(__file__).resolve().parents[1]


def test_flagship_from_history_to_receipt_and_recipient_without_private_export(tmp_path):
    output = tmp_path / 'PRIVATE-CLIENT-project-and-quotes'
    run = subprocess.run([sys.executable, str(ROOT / 'scripts/run_flagship.py'), '--out', str(output)],
                         check=True, capture_output=True, text=True)
    assert 'recipient use passed' in json.loads(run.stdout)['result']
    public = json.loads((output / 'flagship.json').read_text())
    execution = json.loads((output / 'execution.private.json').read_text())
    assert execution['receipt']['verification']['status'] == 'passed'
    assert execution['again']['inputs']['label'] != execution['receipt']['inputs']['label']
    assert execution['sources_preserved']
    finding = public['finding']
    assert len(finding['sources']) == 2 and len(finding['exceptions']) == 1
    for citation in finding['sources'] + finding['exceptions']:
        source = output / 'history' / citation['file']
        line = json.loads(source.read_text().splitlines()[citation['line'] - 1])
        assert citation['quote'] == line['message']['content'][0]['text']
        assert citation['date'] == line['timestamp']
    for checked in execution['receipt']['checks']:
        actual = hashlib.sha256((output / 'project' / checked['file']).read_bytes()).hexdigest()
        assert checked['sha256'] == actual and checked['expected_sha256_matches']
    assert public['empty']['findings'] == []
    recipe = validate_recipe(json.loads((output / 'setup.json').read_text()))
    assert recipe == public['recipe']
    exported = ''.join((output / name).read_text() for name in ['flagship.json', 'setup.json', 'setup.html'])
    assert str(output) not in exported and str(Path.home()) not in exported
    assert 'PRIVATE-CLIENT' not in exported and 'managed_sha256' not in exported
    assert 'note-only handoff' not in (output / 'setup.html').read_text()
    target = output / 'recipient-project/AGENTS.md'
    assert target.is_file() and 'Usual Pop' in target.read_text()
    recipient = json.loads((output / 'recipient-private/setup.json').read_text())
    assert recipient['items']['pop']['verification']['live_agent'] is False
    # The personal routine body does not travel with the Loops module selection.
    assert not (output / 'recipient-private/loops').exists()


def test_catalog_readme_and_minimal_contributor_example():
    for args in [[], ['--catalog', str(ROOT / 'examples/catalog/item.json')]]:
        check = subprocess.run([sys.executable, str(ROOT / 'scripts/validate_catalog.py'), *args],
                               check=True, capture_output=True, text=True)
        assert json.loads(check.stdout)['valid']
    example = subprocess.run([sys.executable, str(ROOT / 'examples/catalog/hello.py')],
                             check=True, capture_output=True, text=True)
    assert json.loads(example.stdout)['network'] is False
