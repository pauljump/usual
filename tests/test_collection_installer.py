"""Managed installer preservation and legacy dispatch platform regressions."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest

from usual import collection_cli

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('usual_test_installer', ROOT / 'install.py')
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


def source(root):
    for directory in ('scripts', 'references', 'demo/fixtures', 'src/usual'):
        (root / directory).mkdir(parents=True)
    (root / 'SKILL.md').write_text('Example Usual skill\n')
    (root / 'LICENSE').write_text('MIT License\nCopyright Example\n')
    (root / 'scripts/usual.py').write_text('print("example")\n')
    (root / 'src/usual/__init__.py').write_text('')
    return root


def test_managed_parent_symlink_cannot_write_outside_skill(tmp_path):
    root = source(tmp_path / 'source')
    target = tmp_path / 'client/skills/usual'
    installer.install(root, target)
    external = tmp_path / 'unrelated-user-scripts'
    (target / 'scripts').rename(external)
    (target / 'scripts').symlink_to(external, target_is_directory=True)
    (root / 'scripts/new.py').write_text('print("upstream update")\n')
    with pytest.raises(ValueError, match='symlink'):
        installer.install(root, target)
    assert not (external / 'new.py').exists()
    assert (target / 'scripts').is_symlink()
    assert (external / 'usual.py').read_text() == 'print("example")\n'


def test_manifest_symlink_is_preserved_and_not_followed(tmp_path):
    root = source(tmp_path / 'source')
    target = tmp_path / 'client/skills/usual'
    target.mkdir(parents=True)
    external = tmp_path / 'external-manifest.json'
    external.write_text('{"keep":"my unrelated file"}\n')
    (target / '.usual-install.json').symlink_to(external)
    with pytest.raises(ValueError, match='symlink'):
        installer.install(root, target)
    assert external.read_text() == '{"keep":"my unrelated file"}\n'
    assert (target / '.usual-install.json').is_symlink()
    assert not (target / 'SKILL.md').exists()


@pytest.mark.parametrize('component', ['.agents', '.agents/skills', '.agents/usual-install-backups'])
def test_supplied_account_home_cannot_redirect_install_or_backup(tmp_path, component):
    root = source(tmp_path / 'source')
    account = tmp_path / 'isolated-account'
    outside = tmp_path / 'unrelated-account'
    outside.mkdir()
    (outside / 'keep.txt').write_text('Original account content')
    link = account / component
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match='symlink'):
        installer.install(root, account / '.agents/skills/usual', account)
    assert sorted(p.name for p in outside.iterdir()) == ['keep.txt']
    assert (outside / 'keep.txt').read_text() == 'Original account content'
    assert link.is_symlink()


def test_known_update_installs_license_preserves_unrelated_and_archives_previous(tmp_path):
    root = source(tmp_path / 'source')
    target = tmp_path / 'client/skills/usual'
    installer.install(root, target)
    (target / 'my-notes.md').write_text('Keep this customization.\n')
    old_script = (target / 'scripts/usual.py').read_text()
    (root / 'scripts/usual.py').write_text('print("new version")\n')
    result = installer.install(root, target)
    assert (target / 'scripts/usual.py').read_text() == 'print("new version")\n'
    assert (target / 'my-notes.md').read_text() == 'Keep this customization.\n'
    assert (target / 'LICENSE').read_bytes() == (root / 'LICENSE').read_bytes()
    assert (Path(result['previous_version']) / 'scripts/usual.py').read_text() == old_script
    assert 'LICENSE' in json.loads((target / '.usual-install.json').read_text())['files']


def test_local_managed_edits_block_whole_update_without_losing_customization(tmp_path):
    root = source(tmp_path / 'source')
    target = tmp_path / 'client/skills/usual'
    installer.install(root, target)
    (target / 'scripts/usual.py').write_text('print("my custom script")\n')
    (root / 'SKILL.md').write_text('Upstream new skill\n')
    with pytest.raises(ValueError, match='preserved local edits'):
        installer.install(root, target)
    assert (target / 'scripts/usual.py').read_text() == 'print("my custom script")\n'
    assert (target / 'SKILL.md').read_text() == 'Example Usual skill\n'


def test_known_legacy_hashes_allow_upgrade_without_existing_manifest(tmp_path):
    root = source(tmp_path / 'source')
    target = tmp_path / 'client/skills/usual'
    target.mkdir(parents=True)
    (target / 'SKILL.md').write_text('Legacy upstream skill\n')
    import hashlib
    (root / 'references/installer-legacy-hashes.json').write_text(json.dumps({
        'SKILL.md': hashlib.sha256((target / 'SKILL.md').read_bytes()).hexdigest()}))
    installer.install(root, target)
    assert (target / 'SKILL.md').read_text() == 'Example Usual skill\n'


def test_legacy_commands_dispatch_without_importing_unix_collection():
    # Simulate a host without fcntl in a new interpreter. Standard Choices help
    # must still run before any collection platform checks or imports occur.
    code = '''import importlib.abc, sys
class NoFcntl(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "fcntl":
            raise ModuleNotFoundError("simulated non-POSIX host")
sys.meta_path.insert(0, NoFcntl())
from usual.cli import main
raise SystemExit(main(["--help"]))
'''
    result = subprocess.run([sys.executable, '-c', code], cwd=ROOT, env={'PATH': __import__('os').environ['PATH'], 'PYTHONPATH': str(ROOT / 'src')}, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert 'consult' in result.stdout


def test_collection_platform_error_is_clear_and_legacy_dispatch_untouched(monkeypatch):
    # Patch the module reference, not process-wide os.name (Path needs the real OS).
    from types import SimpleNamespace
    monkeypatch.setattr(collection_cli, 'os', SimpleNamespace(name='nt'))
    assert collection_cli.dispatch(['status']) is None
    assert collection_cli.dispatch(['--help']) is None
    with pytest.raises(ValueError, match='macOS or Linux'):
        collection_cli.dispatch(['menu'])
