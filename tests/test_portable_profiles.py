"""End-to-end profile isolation over HTTP, including OAuth client and cookie isolation."""
import base64
import hashlib
import json
import re
import threading
from urllib.request import Request, urlopen, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse, parse_qs
import pytest
from test_portable_memory import pilot, packet


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


@pytest.fixture
def profiles(tmp_path):
    stores = {name: pilot.MemoryStore(tmp_path / (name+'.sqlite3')) for name in ('paul', 'coxy', 'bradford')}
    keys = {name: name+'-'+('x'*40) for name in stores}
    server, _ = pilot.make_server(stores['paul'], token=keys['paul'], profiles={
        name: {'store': stores[name], 'token': keys[name]} for name in ('coxy', 'bradford')})
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    def request(path, data=None, key=None, form=False, **headers):
        if key:
            headers['Authorization'] = 'Bearer '+key
        if data is not None:
            headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
        body = (urlencode(data) if form else json.dumps(data)).encode() if data is not None else None
        return build_opener(NoRedirect).open(Request(base+path, data=body, headers=headers), timeout=3)
    yield base, request, stores, keys
    server.shutdown(); server.server_close(); thread.join()


def test_review_api_and_page_isolation(profiles):
    base, request, stores, keys = profiles
    for name, prefix in [('paul',''), ('coxy','/coxy'), ('bradford','/bradford')]:
        with request(prefix+'/') as response:
            page = response.read().decode()
            assert 'profileName='+json.dumps(name.capitalize()) in page
            assert 'base='+json.dumps(prefix) in page
        for other, key in keys.items():
            if other != name:
                with pytest.raises(HTTPError) as error:
                    request(prefix+'/api/memories', key=key)
                assert error.value.code == 401
        with request(prefix+'/api/import', packet(), key=keys[name]) as response:
            assert json.load(response)['added'] == 1
        with request(prefix+'/api/memories', key=keys[name]) as response:
            result = json.load(response)
            assert result['profile'] == name.capitalize() and len(result['memories']) == 1
        with request(prefix+'/api/unlock', {}, key=keys[name]) as response:
            assert ('Path='+prefix+'/') in response.headers['Set-Cookie']
            expected = 'usual_session' if not prefix else 'usual_session_'+name
            assert response.headers['Set-Cookie'].startswith(expected+'=')
    foreign = stores['bradford'].memories()[0]['id']
    with pytest.raises(HTTPError) as error:
        request('/coxy/api/review', {'id': foreign, 'status': 'accepted'}, key=keys['coxy'])
    assert error.value.code == 400
    assert stores['bradford'].memories()[0]['status'] == 'pending'


def issue(request, base, name, key):
    prefix = '/'+name
    with request(prefix+'/oauth/register', {'client_name':'Synthetic '+name, 'redirect_uris':['https://client.example/callback']}) as response:
        client = json.load(response)
    verifier = 'v'*64
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    params = {'client_id':client['client_id'], 'redirect_uri':'https://client.example/callback',
              'resource':base+prefix+'/mcp', 'response_type':'code', 'code_challenge':challenge,
              'code_challenge_method':'S256', 'state':'profile-test'}
    with request(prefix+'/oauth/authorize?'+urlencode(params)) as response:
        page = response.read().decode()
        assert 'action="'+base+prefix+'/oauth/approve"' in page
        assert 'Collection: '+name.capitalize() in page
        flow = re.search('name="flow" value="([^"]+)"',page)[1]
    with pytest.raises(HTTPError) as error:
        request(prefix+'/oauth/approve', {'flow':flow,'key':key,'approve':'yes'}, form=True, Origin=base)
    assert error.value.code == 303
    code = parse_qs(urlparse(error.value.headers['Location']).query)['code'][0]
    with request(prefix+'/oauth/token', {'grant_type':'authorization_code','client_id':client['client_id'],
        'redirect_uri':params['redirect_uri'],'resource':params['resource'],'code':code,'code_verifier':verifier}, form=True) as response:
        tokens = json.load(response)
    return tokens, client


def rpc(request, prefix, token, name, arguments):
    with request(prefix+'/mcp', {'jsonrpc':'2.0','id':1,'method':'tools/call',
        'params':{'name':name,'arguments':arguments}}, key=token) as response:
        return json.load(response)['result']


def test_oauth_and_mcp_cross_profile_denial(profiles):
    base, request, stores, keys = profiles
    for name in ('coxy','bradford'):
        for metadata_path in ('/'+name+'/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/'+name):
            with request(metadata_path) as response:
                assert json.load(response)['issuer'] == base+'/'+name
        with request('/.well-known/oauth-protected-resource/'+name+'/mcp') as response:
            assert json.load(response)['resource'] == base+'/'+name+'/mcp'
    coxy, client = issue(request, base, 'coxy', keys['coxy'])
    bradford, _ = issue(request, base, 'bradford', keys['bradford'])
    for target in ('/bradford',''):
        denied = rpc(request, target, coxy['access_token'], 'add_to_my_usual', {'memories':packet()['memories']})
        assert denied['isError']
    saved = rpc(request, '/coxy', coxy['access_token'], 'add_to_my_usual', {'memories':packet()['memories']})
    assert not saved['isError']
    found = rpc(request, '/coxy', coxy['access_token'], 'use_my_usual', {'query':''})
    assert len(found['structuredContent']['memories']) == 1
    other = rpc(request, '/bradford', bradford['access_token'], 'use_my_usual', {'query':''})
    assert other['structuredContent']['memories'] == []
    assert stores['paul'].memories() == []
    foreign = found['structuredContent']['memories'][0]['id']
    assert rpc(request, '/bradford', bradford['access_token'], 'exclude_from_my_usual', {'ids':[foreign]})['isError']
    assert stores['coxy'].memories()[0]['status'] == 'observed'
    with pytest.raises(HTTPError) as error:
        request('/bradford/oauth/token', {'grant_type':'refresh_token','refresh_token':coxy['refresh_token'],
            'client_id':client['client_id'],'resource':base+'/coxy/mcp'}, form=True)
    assert error.value.code == 400
    with request('/coxy/oauth/token', {'grant_type':'refresh_token','refresh_token':coxy['refresh_token'],
        'client_id':client['client_id'],'resource':base+'/coxy/mcp'}, form=True) as response:
        renewed = json.load(response)['access_token']
    assert rpc(request, '/bradford', renewed, 'use_my_usual', {'query':''})['isError']
    assert not rpc(request, '/coxy', renewed, 'use_my_usual', {'query':''})['isError']


def test_profile_configuration_cannot_share_store_or_key(tmp_path):
    first, second = pilot.MemoryStore(tmp_path/'one.db'), pilot.MemoryStore(tmp_path/'two.db')
    key='k'*40
    with pytest.raises(ValueError):
        pilot.make_server(first, token=key, profiles={'coxy':{'store':first,'token':'c'*40}})
    with pytest.raises(ValueError):
        pilot.make_server(first, token=key, profiles={'coxy':{'store':second,'token':key}})


def test_named_paul_page_preserves_existing_collection(profiles):
    base, request, stores, keys = profiles
    stores['paul'].import_packet(packet())
    with request('/paul/') as response:
        page = response.read().decode()
        assert 'base="",profileName="Paul"' in page
    with request('/api/memories', key=keys['paul']) as response:
        result = json.load(response)
        assert len(result['memories']) == 1
        assert result['mcp_url'] == base+'/mcp'
    with request('/api/unlock', {}, key=keys['paul']) as response:
        assert response.headers['Set-Cookie'].startswith('usual_session=')
