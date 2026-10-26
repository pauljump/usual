#!/usr/bin/env python3
"""Check the standard product directory without running products or provider calls."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def validate():
    registry = json.loads((ROOT / 'products/registry.json').read_text())
    assert registry['repository'] == 'https://github.com/pauljump/usual'
    seen = set()
    for item in registry['products']:
        slug = item['id']
        assert slug not in seen, f'Duplicate product: {slug}'
        seen.add(slug)
        assert item['path'] == f'products/{slug}'
        assert (ROOT / item['path'] / 'README.md').is_file(), slug
        assert (ROOT / item['source']).exists(), item['source']
        assert (ROOT / item['source']).resolve().is_relative_to(ROOT), item['source']
    return len(seen)

if __name__ == '__main__':
    print(f'{validate()} product entries verified')
