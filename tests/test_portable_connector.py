"""Connector tests use a temporary private collection and synthetic evidence."""
import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlparse
import pytest
from test_portable_memory import pilot, packet
from connector import OAuth, MCP

VERIFIER = 'v' * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).decode().rstrip('=')
ORIGIN = 'https://testing.polyfeeds.dev'
OWNER = 'owner-' + 'x' * 40


def setup(tmp_path):
    store = pilot.MemoryStore(tmp_path / 'memory.sqlite3')
    oauth = OAuth(store, ORIGIN, OWNER)
    client = oauth.register({'client_name': 'Test assistant', 'redirect_uris': ['https://client.example/callback']})
    return store, oauth, client


def authorize(oauth, client, scope='usual:read usual:write'):
    params = dict(client_id=client['client_id'], redirect_uri=client['redirect_uris'][0],
                  resource=oauth.resource, response_type='code', code_challenge_method='S256',
                  code_challenge=CHALLENGE, state='roundtrip', scope=scope)
    flow, payload = oauth.prepare(params)
    target = oauth.approve(flow, OWNER, '', True)
    query = parse_qs(urlparse(target).query)
    assert query['state'] == ['roundtrip'] and query['iss'] == [ORIGIN]
    return {'grant_type': 'authorization_code', 'client_id': client['client_id'],
            'redirect_uri': params['redirect_uri'], 'resource': oauth.resource,
            'code': query['code'][0], 'code_verifier': VERIFIER}


def call(mcp, name, arguments, scopes):
    return mcp.dispatch({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                         'params': {'name': name, 'arguments': arguments}}, scopes)['result']


def test_direct_save_recall_dedupe_and_exclude(tmp_path):
    store, oauth, client = setup(tmp_path)
    tokens = oauth.exchange(authorize(oauth, client))
    scopes = oauth.scopes(tokens['access_token'])
    mcp = MCP(store, oauth)
    data = packet()['memories']
    saved = call(mcp, 'add_to_my_usual', {'memories': data}, scopes)
    assert not saved['isError'] and saved['structuredContent']['added'] == 1
    assert store.memories()[0]['status'] == 'observed'
    found = call(mcp, 'use_my_usual', {'query': 'writing mornings'}, scopes)['structuredContent']
    assert found['memories'][0]['exceptions'] == 'Except for the Monday team meeting'
    assert call(mcp, 'add_to_my_usual', {'memories': data}, scopes)['structuredContent']['duplicates'] == 1
    memory_id = store.memories()[0]['id']
    call(mcp, 'exclude_from_my_usual', {'ids': [memory_id]}, scopes)
    assert call(mcp, 'use_my_usual', {'query': ''}, scopes)['structuredContent']['memories'] == []
    call(mcp, 'add_to_my_usual', {'memories': data}, scopes)
    assert store.memories()[0]['status'] == 'excluded'


def test_inferences_and_scope_gates(tmp_path):
    store, oauth, client = setup(tmp_path)
    mcp = MCP(store, oauth)
    memories = packet()['memories']
    memories[0]['basis'] = 'inferred'
    blocked = call(mcp, 'add_to_my_usual', {'memories': memories}, {'usual:read'})
    assert blocked['isError'] and 'mcp/www_authenticate' in blocked['_meta']
    assert store.memories() == []
    call(mcp, 'add_to_my_usual', {'memories': memories}, {'usual:write'})
    assert store.memories()[0]['status'] == 'pending'
    assert call(mcp, 'use_my_usual', {'query': ''}, {'usual:read'})['structuredContent']['memories'] == []
    store.review_memory(store.memories()[0]['id'], 'accepted')
    assert len(call(mcp, 'use_my_usual', {'query': ''}, {'usual:read'})['structuredContent']['memories']) == 1


def test_oauth_pkce_resource_expiry_replay_and_restart(tmp_path):
    store, oauth, client = setup(tmp_path)
    params = authorize(oauth, client)
    for invalid in ({'code_verifier': 'z'*64}, {'resource': 'https://evil.example/mcp'},
                    {'redirect_uri': 'https://evil.example/callback'}, {'client_id': 'other'}):
        with pytest.raises(ValueError):
            oauth.exchange({**params, **invalid})
    tokens = oauth.exchange(params)
    with pytest.raises(ValueError):
        oauth.exchange(params)
    restarted = OAuth(pilot.MemoryStore(store.path), ORIGIN, OWNER)
    assert restarted.scopes(tokens['access_token']) == {'usual:read', 'usual:write'}
    refresh_params = {'grant_type': 'refresh_token', 'refresh_token': tokens['refresh_token'],
                      'resource': oauth.resource, 'client_id': client['client_id']}
    refreshed = restarted.exchange(refresh_params)
    assert refreshed['refresh_token'] != tokens['refresh_token']
    with pytest.raises(ValueError):
        restarted.exchange(refresh_params)
    with store.db() as db:
        db.execute("UPDATE portable_oauth SET expires=? WHERE kind='access'", (time.time()-1,))
    assert restarted.scopes(refreshed['access_token']) == set()


def test_oauth_consent_browser_session_redirect_validation(tmp_path):
    store, oauth, client = setup(tmp_path)
    for uri in ('javascript:alert(1)', 'http://evil.example/cb', 'https://user:pass@example.com/cb', 'https://example.com/cb#fragment'):
        with pytest.raises(ValueError):
            oauth.register({'redirect_uris': [uri]})
    params = dict(client_id=client['client_id'], redirect_uri=client['redirect_uris'][0],
                  resource=oauth.resource, response_type='code', code_challenge_method='S256',
                  code_challenge=CHALLENGE, state='hello')
    with pytest.raises(ValueError):
        oauth.prepare({**params, 'redirect_uri': 'https://evil.example/cb'})
    flow, _ = oauth.prepare(params)
    with pytest.raises(ValueError):
        oauth.approve(flow, 'wrong key', '', True)
    browser = oauth.browser_session()
    target = oauth.approve(flow, '', browser, False)
    assert parse_qs(urlparse(target).query)['error'] == ['access_denied']
    with pytest.raises(ValueError):
        oauth.approve(flow, OWNER, '', True)
    assert oauth.metadata('/.well-known/oauth-authorization-server')['code_challenge_methods_supported'] == ['S256']


def test_protocol_and_atomic_exclusion(tmp_path):
    store, oauth, _ = setup(tmp_path)
    mcp = MCP(store, oauth)
    assert mcp.dispatch({'jsonrpc': '2.0', 'method': 'notifications/initialized'}, set()) is None
    assert mcp.dispatch({}, set())['error']['code'] == -32600
    assert mcp.dispatch({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-11-25'}}, set())['result']['protocolVersion'] == '2025-11-25'
    assert len(mcp.dispatch({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'}, set())['result']['tools']) == 3
    store.import_packet(packet(), direct=True)
    memory_id = store.memories()[0]['id']
    with pytest.raises(ValueError):
        store.exclude_memories([memory_id, 'missing'])
    assert store.memories()[0]['status'] == 'observed'
    assert call(mcp, 'add_to_my_usual', {'memories': [{}]}, {'usual:write'})['isError']
    assert len(store.memories()) == 1
