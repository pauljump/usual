"""Learn: synthetic history only. Provenance, incremental ingestion, review transitions,
retrieval, playbook lifecycle, verification, and prevention of unreviewed promotion."""
import hashlib
import json
import os
import subprocess
import sys
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from usual import learn_cli
from usual.learn import Learn, parse_check, validate_body
from usual.learn_extract import extract
from usual.learn_server import make_server

ROOT = Path(__file__).resolve().parents[1]
INJECTED = ('The following is the Codex agent history whose request action you are assessing. '
            'tool exec result: listen EADDRINUSE: address already in use 127.0.0.1:3041 retry please')


def claude(path, cwd, turns, session):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w') as handle:
        for n, (role, text, date) in enumerate(turns):
            handle.write(json.dumps({'type': role, 'sessionId': session, 'uuid': f'{session}-{n}', 'timestamp': date, 'cwd': cwd,
                                     'message': {'role': role, 'content': [{'type': 'text', 'text': text}]}}) + '\n')


def codex(path, cwd, turns):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w') as handle:
        handle.write(json.dumps({'type': 'session_meta', 'timestamp': '2026-09-03T09:00:00Z', 'payload': {'id': path.stem, 'cwd': cwd}}) + '\n')
        for n, (role, text, date) in enumerate(turns):
            kind = 'input_text' if role == 'user' else 'output_text'
            handle.write(json.dumps({'type': 'response_item', 'timestamp': date, 'payload': {
                'type': 'message', 'role': role, 'id': f'{path.stem}-{n}', 'content': [{'type': kind, 'text': text}]}}) + '\n')


@pytest.fixture
def world(tmp_path):
    projects = tmp_path / 'work/projects'
    hist = tmp_path / 'history'
    claude(hist / 'claude/a.jsonl', str(projects / 'alpha'), [
        ('user', 'The alpha api service crash-loops with EADDRINUSE on port 4100 again after the deploy', '2026-09-01T10:00:00Z'),
        ('assistant', 'Root cause: an orphan node process from the old daemon is holding port 4100. I stopped that PID and PM2 bound the port.', '2026-09-01T10:05:00Z'),
        ('assistant', 'Here is the draft email to the investor, with a short intro — and a clear ask: a call next week.', '2026-09-01T10:10:00Z'),
        ('user', 'No dashes and no colons in the email to the investor please', '2026-09-01T10:11:00Z')], 'sess-a')
    claude(hist / 'claude/b.jsonl', str(projects / 'beta'), [
        ('user', 'beta web is down, logs show EADDRINUSE address already in use on 5200 for the web process', '2026-09-02T10:00:00Z'),
        ('assistant', 'The cause was an orphan process left by the previous daemon holding 5200; fixed by stopping that PID.', '2026-09-02T10:04:00Z'),
        ('assistant', 'Draft note to the landlord: Hello — quick question: can we move the date?', '2026-09-02T10:09:00Z'),
        ('user', 'No dashes no colons in that note to the landlord, keep it plain and short', '2026-09-02T10:10:00Z'),
        ('user', INJECTED, '2026-09-02T10:12:00Z'),
        ('user', 'still broken, beta web shows the same error', '2026-09-02T10:20:00Z'),
        ('assistant', 'A second orphan held 5200; stopped that PID too.', '2026-09-02T10:25:00Z'),
        ('user', 'it works now', '2026-09-02T10:26:00Z')], 'sess-b')
    codex(hist / 'codex/rollout-2026-09-03T09-00-00-c.jsonl', str(projects / 'gamma'), [
        ('user', 'gamma server fails again: listen EADDRINUSE on 6100 when pm2 restarts it', '2026-09-03T09:01:00Z'),
        ('assistant', 'Restarted the service through the registry.', '2026-09-03T09:03:00Z'),
        ('user', 'still broken, same error on 6100 after your restart', '2026-09-03T09:05:00Z'),
        ('assistant', 'Found it: the port is held by a stale process from yesterday. Killed that PID; the new process is listening.', '2026-09-03T09:08:00Z'),
        ('user', 'works now, thanks for checking the port owner first', '2026-09-03T09:09:00Z')])
    notes = tmp_path / 'notes'
    (notes / 'memory').mkdir(parents=True)
    (notes / 'memory/orphan.md').write_text('# Orphan port holder\n\nWhen EADDRINUSE appears, check the listener PID with lsof and stop only that orphan.\n')
    for name, body in (('brain', 'Use the tunnel. Always verify content after deploy.\n'), ('kit', 'Use the tunnel.\n')):
        (notes / name).mkdir()
        (notes / name / 'deploy.md').write_text('# Deploy\n\n' + body)
    home = tmp_path / 'private-home'
    selection = {'transcripts': [('claude', hist / 'claude'), ('codex', hist / 'codex')],
                 'docs': [('memory', notes / 'memory'), ('playbook', notes / 'brain'), ('playbook', notes / 'kit')]}
    return {'home': home, 'hist': hist, 'notes': notes, 'selection': selection, 'projects': projects}


def ingest(world, **kw):
    return Learn(world['home']).ingest(world['selection']['transcripts'], world['selection']['docs'], **kw)


def prepared(world):
    ingest(world)
    learn = Learn(world['home'])
    extract(learn, choices_db=None)
    return learn


def candidate(learn, kind):
    return next(c for c in learn.candidates() if c['kind'] == kind)


def packet_sources(learn, cand_id):
    return {s['source']: s for c in learn.handoff(25, ids=[cand_id])['candidates'] for s in c['sources']}


def interpret_orphan(learn, confidence='medium'):
    cand = candidate(learn, 'recurring_problem')
    sources = packet_sources(learn, cand['id'])
    human = next(s for s in sources.values() if s['author'] == 'human' and 'EADDRINUSE' in s['text'])
    item = {'candidate': cand['id'], 'kind': 'recurring_problem',
            'statement': 'EADDRINUSE after a restart means an orphan holds the port; stop only that PID.',
            'scope': {'projects': ['alpha', 'beta', 'gamma'], 'context': 'PM2 services'}, 'exceptions': ['No listener means a different fix'],
            'rationale': 'Three sessions in three projects.', 'confidence': confidence,
            'question': {'format': 'mc', 'prompt': 'Default for EADDRINUSE?', 'alternatives': ['Kill everything on the port']},
            'citations': [{'source': human['source'], 'quote': 'EADDRINUSE', 'stance': 'supports'}]}
    return learn.interpret({'interpretations': [item]}, 'claude')['created'][0]


def body(**changes):
    data = {'title': 'Orphan holds the port', 'problem': 'A PM2 service crash-loops on EADDRINUSE.',
            'when_to_use': ['EADDRINUSE after a restart'], 'when_not_to_use': ['No listener on the port'],
            'inputs': ['port'], 'prerequisites': ['Shell on the host'], 'scope': {'projects': ['alpha', 'beta'], 'note': ''},
            'steps': ['Find the listener PID', 'Compare it with PM2', 'Stop only the orphan PID with current permission'],
            'scripts': [{'name': 'who-holds', 'language': 'sh', 'body': 'lsof -nP -iTCP:$PORT -sTCP:LISTEN', 'read_only': True}],
            'outputs': ['One listener owned by PM2'], 'verification': [{'criterion': 'Marker file exists', 'check': {'type': 'file', 'path': '{marker}'}}],
            'exceptions': ['Fleet-wide cleanup is the user\'s call'], 'failure_handling': ['Stop and report'],
            'fresh_judgment': ['More than one orphan'], 'permissions': ['Stopping a process'], 'triggers': ['EADDRINUSE', 'orphan'], 'evidence': []}
    data.update(changes)
    return data


def confirm(learn, learning_id, **kw):
    item = learn.item(learning_id)
    return learn.answer(item['id'], kw.pop('verdict', 'confirmed'), revision=item['learning']['revision'], choice=kw.pop('choice', 0), **kw)


# ---------------------------------------------------------------- ingestion and provenance
def test_ingestion_is_incremental_and_resumable(world):
    first = ingest(world, max_files=1)
    assert first['indexed'] == 1 and first['remaining'] > 0
    second = ingest(world)
    assert second['indexed'] == first['remaining'] and second['remaining'] == 0 and second['errors'] == 0
    third = ingest(world)
    assert third['indexed'] == 0 and third['unchanged'] == third['discovered']
    with (world['hist'] / 'claude/a.jsonl').open('a') as handle:
        handle.write(json.dumps({'type': 'user', 'sessionId': 'sess-a', 'uuid': 'sess-a-9', 'timestamp': '2026-09-04T10:00:00Z',
                                 'cwd': '/x', 'message': {'role': 'user', 'content': 'one more synthetic request'}}) + '\n')
    fourth = ingest(world)
    assert fourth['indexed'] == 1 and fourth['network_calls'] == 0
    assert ingest(world, dry_run=True)['indexed'] == 0


def test_oversized_lines_are_counted_not_fatal(world):
    big = world['hist'] / 'claude/big.jsonl'
    big.write_text(json.dumps({'type': 'user', 'message': {'role': 'user', 'content': 'x' * (5 * 1024 * 1024)}}) + '\n' +
                   json.dumps({'type': 'user', 'sessionId': 'big', 'uuid': 'b1', 'timestamp': '2026-09-05T10:00:00Z', 'cwd': '/y',
                               'message': {'role': 'user', 'content': 'a normal human request about the release checklist'}}) + '\n')
    result = ingest(world)
    assert result['errors'] == 0
    with Learn(world['home']).db() as db:
        detail = json.loads(db.execute('SELECT detail FROM ingest_files WHERE path=?', (str(big),)).fetchone()[0])
    assert detail['malformed_lines'] == 1 and detail['inserted_turns'] == 1


def test_extraction_cites_exact_bytes_and_excludes_injected_turns(world):
    learn = prepared(world)
    cand = candidate(learn, 'recurring_problem')
    assert cand['signature'] == 'EADDRINUSE' and cand['stats']['sessions'] == 3
    assert set(cand['stats']['projects']) == {'alpha', 'beta', 'gamma'}
    with learn.db() as db:
        rows = [dict(r) for r in db.execute('SELECT * FROM sources')]
    assert rows and not any(r['text'].startswith('The following is the Codex agent history') for r in rows)
    for row in rows:
        if row['kind'] in ('human_turn', 'assistant_turn'):
            with open(row['path'], 'rb') as handle:
                handle.seek(row['byte_start'])
                raw = handle.read(row['byte_end'] - row['byte_start'])
            assert hashlib.sha256(raw).hexdigest() == row['sha256']
            assert row['author'] == ('human' if row['kind'] == 'human_turn' else 'assistant')
    kinds = {c['kind'] for c in learn.candidates()}
    assert {'recurring_problem', 'conflict', 'failed_then_worked'} <= kinds
    ftw = candidate(learn, 'failed_then_worked')
    assert ftw['stats']['sessions'] >= 1
    again = extract(learn, choices_db=None)
    assert sum(again['new_candidates'].values()) == 0  # Stable IDs: re-running is idempotent.


def test_home_must_stay_out_of_repositories(tmp_path):
    repo = tmp_path / 'repo'
    (repo / '.git').mkdir(parents=True)
    with pytest.raises(ValueError, match='outside Git'):
        Learn(repo / 'home')


# ---------------------------------------------------------------- interpretation validation
def test_interpretation_requires_exact_quotes_and_human_support(world):
    learn = prepared(world)
    cand = candidate(learn, 'recurring_problem')
    sources = packet_sources(learn, cand['id'])
    human = next(s for s in sources.values() if s['author'] == 'human')
    assistant = next(s for s in sources.values() if s['author'] == 'assistant')
    base = {'candidate': cand['id'], 'kind': 'recurring_problem', 'statement': 'S', 'scope': {'projects': []}, 'exceptions': [],
            'rationale': 'R', 'confidence': 'low', 'question': {'format': 'tf', 'prompt': 'Q?'}}
    with pytest.raises(ValueError, match='exactly match'):
        learn.interpret({'interpretations': [{**base, 'citations': [{'source': human['source'], 'quote': 'not in the text at all', 'stance': 'supports'}]}]}, 'claude')
    with pytest.raises(ValueError, match='human-authored'):
        learn.interpret({'interpretations': [{**base, 'kind': 'correction', 'citations': [{'source': assistant['source'], 'quote': assistant['text'][:20], 'stance': 'supports'}]}]}, 'codex')
    other = candidate(learn, 'conflict')
    foreign = next(iter(packet_sources(learn, other['id'])))
    good = {**base, 'citations': [{'source': human['source'], 'quote': 'EADDRINUSE', 'stance': 'supports'}]}
    with pytest.raises(ValueError, match='not supplied'):
        learn.interpret({'interpretations': [good, {**base, 'candidate': cand['id'], 'citations': [{'source': foreign, 'quote': 'Deploy', 'stance': 'supports'}]}]}, 'claude')
    assert learn.queue()['progress']['pending'] == 0  # Atomic: the valid item was not stored either.
    skipped = learn.interpret({'interpretations': [{'candidate': other['id'], 'skip': 'Not enough support'}]}, 'claude')
    assert skipped['skipped'] and other['id'] not in {c['id'] for c in learn.candidates(open_only=True)}


# ---------------------------------------------------------------- human review transitions
def test_review_transitions_are_explicit_append_only_and_undoable(world):
    learn = prepared(world)
    lid = interpret_orphan(learn)
    item = learn.item(lid)
    assert item['learning']['layers']['user_confirms']['status'] == 'candidate'
    with pytest.raises(ValueError, match='explicit user'):
        learn.answer(item['id'], 'confirmed', revision=0, choice=0, reviewer='agent')
    with pytest.raises(ValueError, match='explicit user'):
        learn.answer(item['id'], 'confirmed', revision=0, choice=0, channel='agent')
    with pytest.raises(ValueError, match='changed since'):
        learn.answer(item['id'], 'confirmed', revision=5, choice=0)
    with pytest.raises(ValueError, match='limited scope'):
        learn.answer(item['id'], 'narrowed', revision=0)
    corrected = learn.answer(item['id'], 'confirmed', revision=0, choice=1, elapsed_ms=4200)
    assert corrected['status'] == 'corrected' and corrected['effective_statement'] == 'Kill everything on the port'
    undone = learn.undo(lid, revision=1)
    assert undone['status'] == 'candidate' and undone['effective_statement'] == undone['statement']
    narrowed = learn.answer(item['id'], 'narrowed', revision=2, scope='Only on the Mini')
    assert narrowed['status'] == 'narrowed' and narrowed['effective_scope']['context'] == 'Only on the Mini'
    assert [r['verdict'] for r in narrowed['reviews']] == ['corrected', 'undo', 'narrowed']
    outdated = learn.answer(item['id'], 'outdated', revision=3, note='Fleet runner fixed this')
    assert outdated['status'] == 'outdated'
    assert learn.metrics()['measured']['median_seconds_per_answer'] == 4.2


def test_cli_refuses_unconfirmed_human_actions(world, capsys):
    learn = prepared(world)
    lid = interpret_orphan(learn)
    item = learn.item(lid)
    home = str(world['home'])
    assert learn_cli.main('learn', ['answer', item['id'], '--verdict', 'confirmed', '--choice', '0'], home) == 2
    assert 'Human review is required' in capsys.readouterr().err
    assert learn_cli.main('learn', ['answer', item['id'], '--verdict', 'confirmed', '--choice', '0', '--confirm-user-review'], home) == 0
    assert json.loads(capsys.readouterr().out)['status'] == 'confirmed'


# ---------------------------------------------------------------- no unreviewed promotion
def test_unreviewed_learning_and_drafts_are_never_standing_procedures(world, tmp_path):
    learn = prepared(world)
    lid = interpret_orphan(learn)
    evidence = [c['source']['id'] for c in learn.learning(lid)['citations']]
    with pytest.raises(ValueError, match='only a user-confirmed'):
        learn.draft('orphan-port', body(evidence=evidence), [lid])
    item = learn.item(lid)
    learn.answer(item['id'], 'deferred', revision=0)
    with pytest.raises(ValueError, match='only a user-confirmed'):
        learn.template([lid])
    learn.answer(item['id'], 'confirmed', revision=1, choice=0)
    with pytest.raises(ValueError, match='sources cited'):
        learn.draft('orphan-port', body(evidence=['src_invented']), [lid])
    draft = learn.draft('orphan-port', body(evidence=evidence), [lid])
    assert draft['status'] == 'draft'
    found = learn.find('service crash-loops with EADDRINUSE after restart', project=str(world['projects'] / 'alpha'), agent='codex')
    assert found['playbooks'] == [] and found['unreviewed']['drafts'][0]['slug'] == 'orphan-port'
    with pytest.raises(ValueError, match='Only an approved'):
        learn.use('orphan-port', 'claude', 'fix alpha')
    trial = learn.use('orphan-port', 'claude', 'try the draft', trial=True)
    assert trial['trial'] is True and learn.version(draft['id'])['status'] == 'draft'
    with pytest.raises(ValueError, match='explicit user review'):
        learn.review_playbook(draft['id'], 'approve', channel='agent')
    with pytest.raises(ValueError, match='already awaits review'):
        learn.draft('orphan-port', body(evidence=evidence), [lid])


# ---------------------------------------------------------------- lifecycle, retrieval, verification
def test_playbook_lifecycle_retrieval_verification_and_improvement(world, tmp_path):
    learn = prepared(world)
    lid = interpret_orphan(learn)
    confirm(learn, lid)
    evidence = [c['source']['id'] for c in learn.learning(lid)['citations']]
    v1 = learn.review_playbook(learn.draft('orphan-port', body(evidence=evidence), [lid])['id'], 'approve', note='Looks right')
    assert v1['status'] == 'approved'
    alpha = learn.find('alpha api crash-loops with EADDRINUSE on 4100', project=str(world['projects'] / 'alpha'), agent='claude')
    hit = alpha['playbooks'][0]
    assert hit['slug'] == 'orphan-port' and hit['applicability'] == 'in_scope' and hit['permissions_needed_now'] == ['Stopping a process']
    gamma = learn.find('EADDRINUSE on 6100', project=str(world['projects'] / 'gamma'), agent='codex')
    assert gamma['playbooks'][0]['applicability'] == 'out_of_scope'
    assert learn.find('bake sourdough bread', agent='codex')['playbooks'] == []
    # Use from both agents against the same store; checks run by Usual are distinct from agent claims.
    marker = tmp_path / 'marker.txt'
    marker.write_text('ok')
    use = learn.use('orphan-port', 'codex', 'alpha is down', str(world['projects'] / 'alpha'))
    verified = learn.verify(use['use'], declared=True, inputs={'marker': str(marker)}, reported='pytest passed', passed=True)
    assert [v['kind'] for v in verified['verifications']] == ['usual_executed', 'agent_reported'] and all(v['passed'] for v in verified['verifications'])
    learn.finish_use(use['use'], 'followed')
    failing = learn.use('orphan-port', 'claude', 'beta is down', str(world['projects'] / 'beta'))
    assert not learn.verify(failing['use'], [parse_check('file:' + str(tmp_path / 'missing'))])['verifications'][0]['passed']
    learn.finish_use(failing['use'], 'deviated', deviations=['Two orphans held the port; stopped both after asking'])
    concerns = learn.find('EADDRINUSE crash-loops', project=str(world['projects'] / 'beta'), agent='claude')['playbooks'][0]['concerns']
    assert any('failed verification' in c for c in concerns) and any('deviated' in c for c in concerns)
    proposal = learn.improve('orphan-port')
    assert len(proposal['signals']) == 1 and proposal['signals'][0]['deviations']
    v2 = learn.revise('orphan-port', body(evidence=evidence, fresh_judgment=['More than one orphan: ask before stopping each']), change_note='From the beta deviation')
    assert v2['status'] == 'draft' and '+- More than one orphan: ask before stopping each' in v2['diff']
    assert learn.find('EADDRINUSE', agent='claude')['playbooks'][0]['version'] == 1  # The draft does not replace v1.
    narrowed = learn.review_playbook(v2['id'], 'narrow', scope={'projects': ['alpha', 'beta', 'gamma'], 'note': 'Mini only'})
    assert narrowed['version'] == 3 and narrowed['status'] == 'approved' and narrowed['origin'] == 'human-narrow'
    statuses = {h['version']: h['status'] for h in narrowed['history']}
    assert statuses == {1: 'superseded', 2: 'superseded', 3: 'approved'}
    rolled = learn.rollback('orphan-port', 1, note='v3 scope too wide')
    assert rolled['version'] == 4 and rolled['body'] == v1['body'] and rolled['origin'] == 'rollback'
    retired = learn.retire('orphan-port', 'Fleet runner now prevents orphans')
    assert retired['status'] == 'retired' and learn.find('EADDRINUSE', agent='codex')['playbooks'] == []
    assert len(learn.version(slug='orphan-port', number=1)['history']) == 4  # Provenance survives every transition.
    metrics = learn.metrics()
    assert metrics['measured']['retrievals_by_agent']['claude'] >= 2 and metrics['measured']['retrievals_by_agent']['codex'] >= 2
    assert metrics['measured']['uses_by_agent'] == {'claude': 1, 'codex': 1, 'other': 0}
    assert 'estimate' in metrics['estimated']['method']


def test_edit_cannot_smuggle_unreviewed_evidence(world):
    learn = prepared(world)
    lid = interpret_orphan(learn)
    confirm(learn, lid)
    evidence = [c['source']['id'] for c in learn.learning(lid)['citations']]
    draft = learn.draft('orphan-port', body(evidence=evidence), [lid])
    with pytest.raises(ValueError, match='unreviewed evidence'):
        learn.review_playbook(draft['id'], 'edit-and-approve', body={'evidence': evidence + ['src_other']})
    edited = learn.review_playbook(draft['id'], 'edit', body={'steps': ['Ask first', 'Then find the PID']})
    assert edited['status'] == 'draft' and edited['origin'] == 'human-edit' and '+2. Then find the PID' in edited['diff']


def test_body_validation_and_checks():
    with pytest.raises(ValueError, match='missing'):
        validate_body({'title': 'x'})
    with pytest.raises(ValueError, match='http, port or file'):
        validate_body(body(verification=[{'criterion': 'c', 'check': {'type': 'shell', 'cmd': 'rm -rf /'}}]))
    assert parse_check('http:http://127.0.0.1:9/health=204') == {'type': 'http', 'url': 'http://127.0.0.1:9/health', 'expect': 204}
    assert parse_check('port:4100') == {'type': 'port', 'port': 4100, 'expect_listeners': 1}


# ---------------------------------------------------------------- UI boundary and shared entrypoint
def test_review_server_requires_capability_and_records_human_answers(world):
    learn = prepared(world)
    lid = interpret_orphan(learn)
    server, token = make_server(learn)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'

    def call(path, data=None, auth=True, host=None):
        headers = {'Content-Type': 'application/json'}
        if auth:
            headers['Authorization'] = 'Bearer ' + token
        if host:
            headers['Host'] = host
        request = Request(base + path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
        with urlopen(request, timeout=5) as response:
            return json.loads(response.read())
    try:
        with urlopen(base + '/', timeout=5) as response:
            page = response.read().decode()
            assert 'What execution verifies' in page and response.headers['Cache-Control'] == 'no-store'
        with pytest.raises(HTTPError) as denied:
            call('/api/queue', auth=False)
        assert denied.value.code == 401
        with pytest.raises(HTTPError) as foreign:
            call('/api/queue', host='evil.example')
        assert foreign.value.code == 403
        queue = call('/api/queue')
        item = call('/api/item/' + queue['items'][0]['id'])
        assert item['learning']['citations'][0]['quote'] in item['learning']['citations'][0]['source']['text']
        saved = call('/api/answer', {'id': item['id'], 'verdict': 'confirmed', 'choice': 0, 'revision': 0, 'elapsed_ms': 3000})
        assert saved['status'] == 'confirmed' and saved['reviews'][-1]['channel'] == 'ui'
        evidence = [c['source']['id'] for c in learn.learning(lid)['citations']]
        draft = learn.draft('orphan-port', body(evidence=evidence), [lid])
        reviewed = call('/api/playbook/review', {'version_id': draft['id'], 'verdict': 'approve'})
        assert reviewed['status'] == 'approved'
    finally:
        server.shutdown()
        server.server_close()


def test_codex_and_claude_share_one_store_through_the_cli(world):
    learn = prepared(world)
    lid = interpret_orphan(learn)
    confirm(learn, lid)
    evidence = [c['source']['id'] for c in learn.learning(lid)['citations']]
    learn.review_playbook(learn.draft('orphan-port', body(evidence=evidence), [lid])['id'], 'approve')
    env = {**os.environ, 'PYTHONPATH': str(ROOT / 'src')}
    results = {}
    for agent in ('codex', 'claude'):
        out = subprocess.run([sys.executable, str(ROOT / 'scripts/usual.py'), '--home', str(world['home']), 'playbook', 'find',
                              'EADDRINUSE crash loop', '--project', str(world['projects'] / 'alpha'), '--agent', agent],
                             capture_output=True, text=True, env=env, check=True)
        results[agent] = json.loads(out.stdout)
    assert results['codex']['playbooks'][0]['version_id'] == results['claude']['playbooks'][0]['version_id']
    with learn.db() as db:
        assert {r[0] for r in db.execute('SELECT agent FROM retrievals')} == {'codex', 'claude'}


def test_recall_index_drops_codex_approval_prompts(world):
    ingest(world)
    import sqlite3
    conn = sqlite3.connect(world['home'] / 'recall/index.sqlite3')
    try:
        texts = [r[0] for r in conn.execute("SELECT text FROM turns WHERE role='user'")]
    finally:
        conn.close()
    assert texts and not any(t.startswith('The following is the Codex agent history') for t in texts)


def test_merged_candidates_share_one_learning_and_count_in_recurrence(world):
    learn = prepared(world)
    problem, fixed = candidate(learn, 'recurring_problem'), candidate(learn, 'failed_then_worked')
    outcome = next(s for s in packet_sources(learn, fixed['id']).values() if s['text'] == 'it works now')
    item = {'candidate': problem['id'], 'also': [fixed['id']], 'kind': 'recurring_problem', 'statement': 'Orphans hold ports.',
            'scope': {'projects': []}, 'exceptions': [], 'rationale': 'R', 'confidence': 'high',
            'question': {'format': 'tf', 'prompt': 'True?'},
            'citations': [{'source': outcome['source'], 'quote': 'it works now', 'stance': 'supports'}]}
    lid = learn.interpret({'interpretations': [item]}, 'codex')['created'][0]
    assert fixed['id'] not in {c['id'] for c in learn.candidates(open_only=True)}
    assert problem['stats']['investigation_turns'] and 'investigation_minutes' in problem['stats']
    confirm(learn, lid)
    learn.review_playbook(learn.draft('orphan-port', body(evidence=[outcome['source']]), [lid])['id'], 'approve')
    recurrence = learn.metrics()['measured']['historical_recurrence'][0]
    assert recurrence['historical_sessions_with_problem'] == problem['stats']['sessions'] + fixed['stats']['sessions']
