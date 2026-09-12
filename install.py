#!/usr/bin/env python3
"""Install the same self-contained skill into Codex and/or Claude Code. No network."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
from datetime import datetime, timezone


def archive_skill(target):
    archive = target.parent.parent / 'usual-install-backups'
    archive.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')
    backup = archive / (target.name + '-' + stamp)
    target.rename(backup)
    return backup


def reject_managed_symlinks(path, target):
    """A staged copy must never follow a preexisting link out of the skill."""
    current = Path(path)
    target = Path(target)
    if not current.is_relative_to(target):
        raise ValueError('Managed install path escaped the selected skill directory.')
    while True:
        if current.is_symlink():
            raise ValueError('Installation preserved a symlink in the managed path: ' + str(current))
        if current == target:
            break
        current = current.parent


def install_boundary(target, account_home=None):
    target = Path(target).absolute()
    if account_home is None:
        if target.parent.name == 'skills':
            account_home = target.parents[2] if target.parents[1].name in ('.agents', '.claude') else target.parents[1]
        else:
            account_home = target.parent
    account_home = Path(account_home).absolute()
    reject_managed_symlinks(target, account_home)
    reject_managed_symlinks(target.parent.parent / 'usual-install-backups', account_home)
    return target, account_home


def install(root, target, account_home=None):
    target, account_home = install_boundary(target, account_home)
    target.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.usual-install-', dir=target.parent))
    backup = None
    try:
        reject_managed_symlinks(target, target)
        reject_managed_symlinks(target / '.usual-install.json', target)
        if target.exists():
            shutil.copytree(target, stage, dirs_exist_ok=True, symlinks=True)
        incoming = Path(tempfile.mkdtemp(prefix='.usual-source-', dir=target.parent))
        try:
            for name in ['SKILL.md', 'LICENSE']:
                shutil.copy2(root / name, incoming / name)
            for name in ['scripts', 'references', 'demo/fixtures', 'src/usual']:
                shutil.copytree(root / name, incoming / name,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.zip', '*.sqlite3', '*.mp4'))
            source_files = [p for p in incoming.rglob('*') if p.is_file()]
            old_manifest = target / '.usual-install.json'
            previous = json.loads(old_manifest.read_text()).get('files', {}) if old_manifest.is_file() else {}
            legacy_path = root / 'references/installer-legacy-hashes.json'
            legacy = json.loads(legacy_path.read_text()) if legacy_path.exists() else {}
            hashes = {}
            conflicts = []
            for source in source_files:
                relative = str(source.relative_to(incoming))
                dest = target / relative
                reject_managed_symlinks(dest, target)
                new_hash = hashlib.sha256(source.read_bytes()).hexdigest()
                hashes[relative] = new_hash
                if dest.is_symlink():
                    conflicts.append(relative)
                elif dest.exists():
                    old_hash = hashlib.sha256(dest.read_bytes()).hexdigest()
                    if old_hash not in {new_hash, previous.get(relative), legacy.get(relative)}:
                        conflicts.append(relative)
            if conflicts:
                raise ValueError('Installation preserved local edits. Reconcile these files before updating: ' + ', '.join(conflicts))
            shutil.copytree(incoming, stage, dirs_exist_ok=True)
            (stage / '.usual-install.json').write_text(json.dumps({'schema_version': 1, 'files': hashes}, indent=2) + '\n')
        finally:
            shutil.rmtree(incoming, ignore_errors=True)
        if target.exists() or target.is_symlink():
            backup = archive_skill(target)
        stage.rename(target)
    except Exception:
        if backup and not target.exists():
            backup.rename(target)
        shutil.rmtree(stage, ignore_errors=True)
        raise
    legacy = target.with_name('whetstone')
    legacy_backup = archive_skill(legacy) if legacy.exists() or legacy.is_symlink() else None
    return {'skill': str(target), 'previous_version': str(backup) if backup else None,
            'previous_name': str(legacy_backup) if legacy_backup else None}


def main():
    parser = argparse.ArgumentParser(description='Install Usual for local Codex and Claude Code. No API key or pip install.')
    parser.add_argument('--client', choices=['codex', 'claude', 'both'], default='both')
    parser.add_argument('--home', type=Path, default=Path.home(), help='Install under another home directory (for isolated validation)')
    args = parser.parse_args()
    args.home = args.home.expanduser().resolve()
    if sys.version_info < (3, 11):
        parser.error('Python 3.11 or newer is required.')
    root = Path(__file__).resolve().parent
    sys.path.insert(0, str(root / 'src'))
    from usual.migration import migrate_home
    targets = []
    if args.client in ('codex', 'both'):
        targets.append(args.home / '.agents/skills/usual')
    if args.client in ('claude', 'both'):
        targets.append(args.home / '.claude/skills/usual')
    # Check both client roots before staging either installation.
    for target in targets:
        install_boundary(target, args.home)
    installed = [install(root, target, args.home) for target in targets]
    print(json.dumps({'installed': installed, 'data': migrate_home(args.home),
        'next': 'Say "use Usual" for guided setup. In Codex: $usual. In Claude Code: /usual. Then: "Build me something with Usual."'}, indent=2))


if __name__ == '__main__':
    main()
