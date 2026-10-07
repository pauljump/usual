"""Thinking profile HTTP contracts and scoped capability isolation."""
import json
from urllib.error import HTTPError
import pytest
from test_portable_profiles import profiles


def analysis(rule='Prefer a small experiment before a large build.', basis='inferred'):
    return {'schema':'usual.thinking.v1','source':'Synthetic demo decision','patterns':[{
        'rule':rule,'context':'Choosing the first product test','tradeoff':'Speed over completeness',
        'quote':'Start with a small test.','exceptions':'Not for an irreversible migration.','basis':basis}]}


def info(request, keys, name):
    with request(('' if name=='paul' else '/'+name)+'/api/thinking', key=keys[name]) as r:
        return json.load(r)


def test_compile_read_only_and_profile_isolation(profiles):
    base, request, stores, keys = profiles
    p=info(request,keys,'paul'); c=info(request,keys,'coxy')
    with request('/api/analysis', analysis(), key=keys['paul']) as r:
        assert json.load(r)['added']==1
    with request('/api/analysis', analysis(), key=keys['paul']) as r:
        assert json.load(r)['duplicate']
    with request(p['read_url'].removeprefix(base)) as r:
        body=r.read().decode()
        assert 'small experiment' in body and 'inferred' in body and 'irreversible migration' in body
        assert r.headers['Cache-Control']=='no-store'
        assert 'noindex' in r.headers['X-Robots-Tag']
    with request(c['read_url'].removeprefix(base)) as r:
        assert 'No decision evidence yet' in r.read().decode()
    readkey=p['read_url'].rsplit('/',1)[1]
    for path,data,key in [('/coxy/thinking/'+readkey,None,None),('/api/analysis',analysis(),readkey),('/api/thinking',None,readkey)]:
        with pytest.raises(HTTPError) as e: request(path,data,key=key)
        assert e.value.code==401
    compiled=info(request,keys,'paul')['profile']
    assert len(compiled['patterns'])==1 and len(compiled['patterns'][0]['evidence'])==1
    aid=compiled['analyses'][0]['id']
    with request('/api/analysis-hide',{'id':aid},key=keys['paul']) as r: assert json.load(r)['hidden']
    with request(p['read_url'].removeprefix(base)) as r: assert 'No decision evidence yet' in r.read().decode()
    # A repeated import must not silently restore hidden evidence.
    with request('/api/analysis',analysis(),key=keys['paul']): pass
    assert not info(request,keys,'paul')['profile']['patterns']


def test_submission_key_only_uploads_and_validation_is_atomic(profiles):
    import re
    base,request,stores,keys=profiles
    p=info(request,keys,'coxy')
    submitkey=re.search(r'/submit#key=([a-f0-9]+)',p['capture'])[1]
    with request('/coxy/submit') as r: assert r.status==200
    assert not info(request,keys,'coxy')['profile']['patterns']
    with request('/coxy/api/analysis',analysis(),key=submitkey) as r: assert json.load(r)['added']==1
    for path,data in [('/api/analysis',analysis()),('/coxy/api/thinking',None),('/coxy/api/analysis-hide',{'id':'x'})]:
        with pytest.raises(HTTPError) as e: request(path,data,key=submitkey)
        assert e.value.code==401
    invalid=analysis();invalid['patterns'].append({'rule':'incomplete'})
    with pytest.raises(HTTPError) as e: request('/coxy/api/analysis',invalid,key=submitkey)
    assert e.value.code==400
    assert len(info(request,keys,'coxy')['profile']['analyses'])==1


def test_matching_rules_keep_evidence_and_conflicts(profiles):
    _,request,stores,keys=profiles
    for source,rule in [('one','Prefer speed.'),('two','Prefer speed.'),('three','Prefer polish.')]:
        packet=analysis(rule);packet['source']=source
        with request('/api/analysis',packet,key=keys['paul']): pass
    result=info(request,keys,'paul')['profile']
    assert len(result['patterns'])==2
    assert sorted(len(g['evidence']) for g in result['patterns'])==[1,2]
    assert 'does not semantically merge' in result['compilation']
