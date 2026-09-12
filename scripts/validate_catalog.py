#!/usr/bin/env python3
"""Validate an item catalog; optionally regenerate the README's menu table."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {'id', 'number', 'name', 'benefit', 'maturity', 'maintainer', 'source',
            'supported_environments', 'requirements', 'configuration', 'install',
            'use', 'remove', 'storage', 'network', 'example', 'verification'}


def validate(catalog):
    if catalog.get('schema_version') != 1 or not isinstance(catalog.get('items'), list):
        raise ValueError('Use schema_version 1 with an items array.')
    seen = set()
    for item in catalog['items']:
        missing = REQUIRED - item.keys()
        if missing:
            raise ValueError('Missing item fields: ' + ', '.join(sorted(missing)))
        if not isinstance(item['id'], str) or not re.fullmatch('[a-z][a-z0-9-]{1,31}', item['id']) or item['id'] in seen:
            raise ValueError('IDs must be stable, unique lowercase identifiers.')
        seen.add(item['id'])
        for key in ['name', 'benefit', 'maturity', 'maintainer', 'storage', 'network', 'example']:
            if not isinstance(item[key], str) or not item[key].strip():
                raise ValueError(key + ' must be nonempty text.')
        if not isinstance(item['source'], dict) or any(not item['source'].get(k) for k in ['url', 'license', 'version']):
            raise ValueError('Source needs URL, license and reviewed version.')
        if not item['source']['url'].startswith('https://'):
            raise ValueError('Source must have an HTTPS provenance URL.')
        for key in ['supported_environments', 'requirements', 'install', 'use', 'remove']:
            if not isinstance(item[key], list) or not item[key] or any(not isinstance(v, str) or not v for v in item[key]):
                raise ValueError(key + ' must be a nonempty text list.')
        if not isinstance(item['configuration'], dict):
            raise ValueError('Configuration must declare its settings schema.')
        for key, setting in item['configuration'].items():
            if setting.get('type') != 'enum' or not setting.get('values') or setting.get('default') not in setting['values']:
                raise ValueError('Initial settings support finite explicit enum values.')
        status = item['verification']
        if not isinstance(status, dict) or not status.get('status') or not isinstance(status.get('tested'), list) or not isinstance(status.get('pending'), list):
            raise ValueError('Verification must separate status, tested and pending.')
    return len(seen)


def readme_table(catalog):
    rows = ['| # | Tool | What it does | Maturity |', '| --- | --- | --- | --- |']
    for item in catalog['items']:
        safe = lambda value: str(value).replace('|', '\\|').replace('\n', ' ')
        rows.append(f"| {safe(item['number'])} | [{safe(item['name'])}](https://tryusual.com/menu/{item['id']}/) | {safe(item['benefit'])} | {safe(item['maturity'])} |")
    return '\n'.join(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, default=ROOT / 'src/usual/catalog.json')
    parser.add_argument('--write-readme', action='store_true')
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_text())
    count = validate(catalog)
    if args.write_readme:
        path = ROOT / 'README.md'
        text = path.read_text()
        start, end = '<!-- usual:menu:start -->', '<!-- usual:menu:end -->'
        if text.count(start) != 1 or text.count(end) != 1:
            raise ValueError('README needs exactly one menu marker pair.')
        head, tail = text.split(start)
        middle, remainder = tail.split(end)
        path.write_text(head + start + '\n' + readme_table(catalog) + '\n' + end + remainder)
    elif args.catalog.resolve() == (ROOT / 'src/usual/catalog.json').resolve():
        text = (ROOT / 'README.md').read_text()
        if readme_table(catalog) not in text:
            raise ValueError('README menu is stale. Run validate_catalog.py --write-readme.')
    print(json.dumps({'valid': True, 'items': count, 'catalog': str(args.catalog)}))


if __name__ == '__main__':
    main()
