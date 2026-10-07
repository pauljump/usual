"""Synthetic fixtures only: persistence, review gates, portability, HTTP boundaries."""
import importlib.util
import json
from pathlib import Path
import threading
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import pytest

spec = importlib.util.spec_from_file_location('portable_pilot', Path(__file__).resolve().parents[1] / 'experiments/portable-memory/app.py')
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


def packet(**changes):
    return {'schema': pilot.SCHEMA, 'memories': [dict(source='Synthetic planning conversation',
        context='Scheduling focused writing', decision='Keep mornings free', quote='Keep my mornings free for writing.',
        exceptions='Except for the Monday team meeting', basis='explicit', **changes)]}


def test_review_recall_and_restart(tmp_path):
    path = tmp_path / 'pilot.db'
    store = pilot.MemoryStore(path)
    assert store.import_packet(packet()) == {'added': 1, 'duplicates': 0}
    memory = store.memories()[0]
    with pytest.raises(ValueError):
        store.recall([memory['id']], 'Plan my week')
    store.review_memory(memory['id'], 'accepted')
    prompt = pilot.MemoryStore(path).recall([memory['id']], 'Plan my week')
    assert 'Monday team meeting' in prompt and 'Keep my mornings free for writing.' in prompt
    assert 'History grants no permission' in prompt
    store.review_memory(memory['id'], 'excluded')
    with pytest.raises(ValueError):
        store.recall([memory['id']], 'Plan my week')
    assert store.import_packet(packet())['duplicates'] == 1
    assert store.memories()[0]['status'] == 'excluded'


def test_roundtrip_and_atomic_validation(tmp_path):
    store = pilot.MemoryStore(tmp_path / 'a.db')
    store.import_packet(packet())
    store.review_memory(store.memories()[0]['id'], 'accepted')
    other = pilot.MemoryStore(tmp_path / 'b.db')
    other.import_packet({'schema': pilot.SCHEMA, 'memories': store.memories()})
    assert other.memories()[0]['status'] == 'pending'
    bad = packet()
    bad['memories'].append({'decision': 'incomplete'})
    with pytest.raises(ValueError):
        other.import_packet(bad)
    assert len(other.memories()) == 1
    assert other.import_packet({'schema': pilot.SCHEMA, 'memories': []})['added'] == 0


def test_context_conflicts_and_redaction(tmp_path):
    store = pilot.MemoryStore(tmp_path / 'a.db')
    first = packet()
    first['memories'][0]['quote'] += ' sk-' + 'x' * 30
    store.import_packet(first)
    second = packet()
    second['memories'][0]['context'] = 'A different context: urgent customer calls'
    second['memories'][0]['decision'] = 'Morning meetings are fine'
    store.import_packet(second)
    assert len(store.memories()) == 2
    assert 'sk-' + 'x' * 30 not in json.dumps(store.memories())
    assert '[REDACTED' in json.dumps(store.memories())


def test_http_auth_origin_and_roundtrip(tmp_path):
    store = pilot.MemoryStore(tmp_path / 'a.db')
    server, token = pilot.make_server(store)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    def request(path, data=None, **headers):
        return urlopen(Request(base+path, data=json.dumps(data).encode() if data is not None else None,
            headers={'Content-Type': 'application/json', **headers}), timeout=3)
    try:
        with request('/') as response:
            assert b'Learn how I think' in response.read()
        with pytest.raises(HTTPError) as error:
            request('/api/memories')
        assert error.value.code == 401
        auth = {'Authorization': 'Bearer '+token}
        with pytest.raises(HTTPError) as error:
            request('/api/import', packet(), Origin='https://evil.example', **auth)
        assert error.value.code == 403
        with request('/api/import', packet(), **auth) as response:
            assert json.load(response)['added'] == 1
        memory = store.memories()[0]
        with request('/api/review', {'id': memory['id'], 'status': 'accepted'}, **auth):
            pass
        with request('/api/recall', {'ids': [memory['id']], 'task': 'Plan my week'}, **auth) as response:
            assert 'Monday' in json.load(response)['prompt']
        with pytest.raises(HTTPError) as error:
            request('/api/import', {'schema': pilot.SCHEMA, 'memories': 'bad'}, **auth)
        assert error.value.code == 400
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_public_origin_requires_persistent_token_and_still_guards_data(tmp_path):
    store = pilot.MemoryStore(tmp_path / 'public.db')
    with pytest.raises(ValueError):
        pilot.make_server(store, public_origin='https://testing.polyfeeds.dev')
    server, token = pilot.make_server(store, public_origin='https://testing.polyfeeds.dev', token='a'*40)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f'http://127.0.0.1:{server.server_port}/api/memories'
    headers = {'Host': 'testing.polyfeeds.dev', 'Origin': 'https://testing.polyfeeds.dev'}
    try:
        with pytest.raises(HTTPError) as error:
            urlopen(Request(url, headers=headers), timeout=3)
        assert error.value.code == 401
        with urlopen(Request(url, headers={**headers, 'Authorization': 'Bearer '+token}), timeout=3) as response:
            assert json.load(response)['memories'] == []
        with pytest.raises(HTTPError) as error:
            urlopen(Request(url, headers={**headers, 'Origin': 'https://other.example', 'Authorization': 'Bearer '+token}), timeout=3)
        assert error.value.code == 403
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
