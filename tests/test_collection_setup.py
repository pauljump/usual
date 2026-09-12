import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest

from usual import collection as c

ROOT = Path(__file__).resolve().parents[1]


def test_pop_independent_install_repeat_edit_disable_preserves_customization(tmp_path):
    home, client = tmp_path / 'data', tmp_path / 'client'
    target = client / '.codex/AGENTS.md'
    target.parent.mkdir(parents=True)
    target.write_text('# My instructions\nUse type hints.\n')
    original = target.read_text()
    first = c.install_pop(home, 'codex', client, 'chrome')
    assert first['item']['installed'] and first['item']['verification']['status'] == 'not-checked'
    assert not (home / 'judgment.sqlite3').exists()
    assert not (home / 'recall').exists()
    c.install_pop(home, 'codex', client, 'chrome')
    assert target.read_text().count(c.BEGIN) == 1
    target.write_text(target.read_text() + '\nKeep my new manual rule.\n')
    c.install_pop(home, 'codex', client, 'both')
    assert target.read_text().startswith(original)
    assert target.read_text().endswith('Keep my new manual rule.\n')
    checked = c.verify_pop(home, 'https://example.com/a?q=b#c')
    assert '[Safari](x-safari-https://example.com/a?q=b#c)' in checked['formatted']
    verification = c.inspect_setup(home)['items']['pop']['verification']
    assert verification['status'] == 'scripted-format-checked'
    assert verification['live_agent'] is False
    c.disable(home, 'pop', remove=True)
    assert c.BEGIN not in target.read_text()
    assert target.read_text().startswith(original)
    assert 'Keep my new manual rule.' in target.read_text()
    assert c.inspect_setup(home)['items']['pop']['selected'] is False


def test_pop_conflicting_rule_and_scope_are_preserved(tmp_path):
    home, client = tmp_path / 'data', tmp_path / 'client'
    c.install_pop(home, 'codex', client)
    target = client / '.codex/AGENTS.md'
    target.write_text(target.read_text().replace('Keep citations', 'My custom behavior. Keep citations'))
    # Deliberately change inside the owned block.
    target.write_text(target.read_text().replace('For an actionable URL', 'Never format a URL'))
    modified = target.read_bytes()
    with pytest.raises(ValueError, match='edited'):
        c.install_pop(home, 'codex', client, 'chrome')
    with pytest.raises(ValueError, match='edited'):
        c.disable(home, 'pop')
    assert target.read_bytes() == modified
    with pytest.raises(ValueError, match='another target'):
        c.install_pop(home, 'claude', client)


def test_unmarked_pop_requires_reconciliation_and_unsupported_client_fails(tmp_path):
    client = tmp_path / 'client'
    target = client / '.codex/AGENTS.md'
    target.parent.mkdir(parents=True)
    target.write_text('## Usual Pop\nMy legacy customized rule.\n')
    with pytest.raises(ValueError, match='unmarked'):
        c.install_pop(tmp_path / 'data', 'codex', client)
    assert target.read_text().endswith('My legacy customized rule.\n')
    with pytest.raises(ValueError, match='Supported instruction'):
        c.install_pop(tmp_path / 'data', 'cursor', client)


@pytest.mark.parametrize('url', ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/\nattack', 'file:///tmp/x'])
def test_pop_unsafe_destinations_rejected(url):
    with pytest.raises(ValueError):
        c.pop_format(url)


def test_pop_http_safari_omitted_markdown_delimiters_encoded():
    text = c.pop_format('http://example.com/a(b)`x?q=two#frag')
    assert 'Safari' not in text
    assert 'googlechrome://example.com/a%28b%29%60x?q=two#frag' in text


def test_export_allowlist_and_isolated_recipient(tmp_path):
    home, client = tmp_path / 'PRIVATE-ACME', tmp_path / 'SECRET-CLIENT'
    c.install_pop(home, 'codex', client, 'chrome')
    state = json.loads((home / 'setup.json').read_text())
    state['private_project'] = 'PRIVATE-PROJECT'
    state['transcript'] = 'SECRET-QUOTE'
    state['credential'] = 'SECRET-CREDENTIAL'
    state['items']['pop']['permission_settings'] = 'PRIVATE-AUTHORITY'
    state['items']['pop']['private_preference'] = 'SECRET-PREFERENCE'
    c.write_json(home / 'setup.json', state)
    with pytest.raises(ValueError, match='Review'):
        c.export_recipe(home)
    recipe = c.export_recipe(home, reviewed=True)
    assert recipe['modules'] == [{'id': 'pop', 'version': '0.1.0'}]
    reviewed = c.export_recipe(home, ['pop.browser'], reviewed=True)
    assert reviewed['modules'][0]['config'] == {'browser': 'chrome'}
    serialized = json.dumps(reviewed) + c.recipe_html(reviewed)
    assert all(word not in serialized for word in ['PRIVATE-', 'SECRET-', str(tmp_path), 'permission_settings', 'transcript'])
    recipient_scope = tmp_path / 'recipient-project'
    recipient_scope.mkdir()
    result = c.import_recipe(tmp_path / 'recipient-data', reviewed, recipient_scope, reviewed=True)
    assert result['setup']['items']['pop']['installed'] is False
    installed = c.install_tool(tmp_path / 'recipient-data', 'pop', recipient_scope)
    assert installed['item']['config']['browser'] == 'chrome'
    verified = c.verify_pop(tmp_path / 'recipient-data', 'https://example.com')
    assert '[Chrome]' in verified['formatted'] and '[Safari]' not in verified['formatted']


def test_recipe_validation_is_atomic_and_no_executable_config(tmp_path):
    valid = {'schema_version': 1, 'kind': 'usual-setup', 'repository': c.REPOSITORY,
             'modules': [{'id': 'pop', 'version': '0.1.0'}, {'id': 'choices', 'version': '99'}]}
    with pytest.raises(ValueError, match='version'):
        c.import_recipe(tmp_path / 'home', valid, tmp_path, reviewed=True)
    assert not (tmp_path / 'home/setup.json').exists()
    valid['modules'] = [{'id': 'pop', 'version': '0.1.0', 'config': {'browser': 'chrome; touch /tmp/no'}}]
    with pytest.raises(ValueError, match='configuration'):
        c.validate_recipe(valid)
    valid['modules'] = [{'id': 'pop', 'version': '0.1.0', 'scope': '/private'}]
    with pytest.raises(ValueError, match='private'):
        c.validate_recipe(valid)


def test_private_storage_rejected_inside_repository(tmp_path):
    (tmp_path / '.git').mkdir()
    with pytest.raises(ValueError, match='outside source'):
        c.install_pop(tmp_path / 'data', 'codex', tmp_path / 'client')


def test_symlink_instruction_preserved(tmp_path):
    outside = tmp_path / 'original'
    outside.write_text('Keep me')
    target = tmp_path / 'client/.codex/AGENTS.md'
    target.parent.mkdir(parents=True)
    target.symlink_to(outside)
    with pytest.raises(ValueError, match='symlink'):
        c.install_pop(tmp_path / 'data', 'codex', tmp_path / 'client')
    assert outside.read_text() == 'Keep me'


def test_installer_preserves_extra_files_and_refuses_modified_owned_files(tmp_path):
    spec = importlib.util.spec_from_file_location('collection_installer', ROOT / 'install.py')
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    target = tmp_path / 'client/.agents/skills/usual'
    installer.install(ROOT, target)
    (target / 'my-notes.md').write_text('User customization')
    installer.install(ROOT, target)
    assert (target / 'my-notes.md').read_text() == 'User customization'
    owned = target / 'SKILL.md'
    owned.write_text(owned.read_text() + '\nMy changed workflow.\n')
    before = owned.read_bytes()
    with pytest.raises(ValueError, match='preserved local edits'):
        installer.install(ROOT, target)
    assert owned.read_bytes() == before


def test_new_commands_do_not_open_choices_database(tmp_path):
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/usual.py'), '--home', str(tmp_path / 'data'),
                             'menu'], check=True, capture_output=True, text=True)
    assert len(json.loads(result.stdout)['items']) == 6
    assert not (tmp_path / 'data').exists()


def test_private_inspection_rejects_a_source_repository_destination(tmp_path):
    repo = tmp_path / 'project'
    (repo / '.git').mkdir(parents=True)
    output = repo / 'setup.private.html'
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/usual.py'), '--home', str(tmp_path / 'data'),
        'setup', 'inspect', '--format', 'html', '--out', str(output)], capture_output=True, text=True)
    assert result.returncode == 2
    assert 'outside source repositories' in result.stdout
    assert not output.exists()


def test_pop_parent_symlink_never_changes_another_client_directory(tmp_path):
    client = tmp_path / 'client'
    client.mkdir()
    elsewhere = tmp_path / 'other-client'
    elsewhere.mkdir()
    target = elsewhere / 'AGENTS.md'
    target.write_text('Keep unrelated client instructions.\n')
    (client / '.codex').symlink_to(elsewhere, target_is_directory=True)
    with pytest.raises(ValueError, match='symlink'):
        c.install_pop(tmp_path / 'data', 'codex', client)
    assert target.read_text() == 'Keep unrelated client instructions.\n'
    assert not (tmp_path / 'data/setup.json').exists()


@pytest.mark.parametrize('owned', ['setup.lock', 'setup.json', 'receipts'])
def test_setup_symlinks_rejected_before_instruction_mutation(tmp_path, owned):
    home = tmp_path / 'data'
    home.mkdir()
    outside = tmp_path / 'original'
    outside.write_text('{"schema_version":1,"items":{}}\n')
    outside.chmod(0o644)
    (home / owned).symlink_to(outside)
    client = tmp_path / 'client'
    target = client / '.codex/AGENTS.md'
    target.parent.mkdir(parents=True)
    target.write_text('Preserve this file.\n')
    with pytest.raises(ValueError, match='symlink'):
        c.install_pop(home, 'codex', client)
    assert target.read_text() == 'Preserve this file.\n'
    assert outside.read_text() == '{"schema_version":1,"items":{}}\n'
    assert outside.stat().st_mode & 0o777 == 0o644


def test_replaced_pop_parent_is_rejected_for_verify_and_disable(tmp_path):
    home, client = tmp_path / 'data', tmp_path / 'client'
    c.install_pop(home, 'codex', client)
    original_parent = client / '.codex'
    replacement = tmp_path / 'elsewhere'
    original_parent.rename(replacement)
    original_parent.symlink_to(replacement, target_is_directory=True)
    before = (replacement / 'AGENTS.md').read_bytes()
    with pytest.raises(ValueError, match='symlink'):
        c.verify_pop(home, 'https://example.com')
    with pytest.raises(ValueError, match='symlink'):
        c.disable(home, 'pop')
    assert (replacement / 'AGENTS.md').read_bytes() == before


def test_escape_installs_distributed_pin_license_and_runnable_private_snippet(tmp_path):
    home, site = tmp_path / 'data', tmp_path / 'site'
    site.mkdir()
    result = c.install_tool(home, 'escape', site)
    assert (site / 'escape-webview.js').read_bytes() == (c.ROOT / 'vendor/escape_webview/escape-webview.js').read_bytes()
    assert (site / 'escape-webview.LICENSE').read_bytes() == (c.ROOT / 'vendor/escape_webview/LICENSE').read_bytes()
    assert 'data-auto data-analytics="off"' in result['receipt']['outcome']
    assert 'data-telemetry' not in result['receipt']['outcome']
    assert result['item']['verification']['status'] == 'not-checked'
    before = (site / 'escape-webview.js').read_bytes()
    c.install_tool(home, 'escape', site)
    c.disable(home, 'escape', remove=True)
    assert (site / 'escape-webview.js').read_bytes() == before


def test_escape_preflights_home_and_all_conflicting_targets(tmp_path):
    site = tmp_path / 'site'
    site.mkdir()
    repo = tmp_path / 'repo'
    repo.mkdir()
    (repo / '.git').mkdir()
    with pytest.raises(ValueError, match='outside source'):
        c.install_tool(repo / 'data', 'escape', site)
    assert list(site.iterdir()) == []
    (site / 'escape-webview.LICENSE').write_text('Customized license file')
    with pytest.raises(ValueError, match='differs'):
        c.install_tool(tmp_path / 'data', 'escape', site)
    assert not (site / 'escape-webview.js').exists()
    assert (site / 'escape-webview.LICENSE').read_text() == 'Customized license file'


def test_repeated_module_install_preserves_verification_and_unrelated_metadata(tmp_path):
    home, site = tmp_path / 'data', tmp_path / 'site'
    site.mkdir()
    c.install_tool(home, 'escape', site)
    state = json.loads((home / 'setup.json').read_text())
    state['items']['escape']['x-user-note'] = 'Do not lose my note'
    state['items']['escape']['verification'] = {'status': 'fixture-only', 'device_verified': False}
    c.write_json(home / 'setup.json', state)
    repeated = c.install_tool(home, 'escape', site)['item']
    assert repeated['x-user-note'] == 'Do not lose my note'
    assert repeated['verification']['status'] == 'fixture-only'


def test_export_does_not_relabel_an_old_selected_version(tmp_path):
    home, client = tmp_path / 'data', tmp_path / 'client'
    c.install_pop(home, 'codex', client)
    state = json.loads((home / 'setup.json').read_text())
    state['items']['pop']['version'] = 'older-version'
    c.write_json(home / 'setup.json', state)
    with pytest.raises(ValueError, match='unsupported version'):
        c.export_recipe(home, reviewed=True)
