"""Synthetic native-history fixtures; no real account history or provider calls."""
import hashlib
import json
from pathlib import Path

import pytest

from usual import history


def claude(path, messages, session=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    session = session or path.stem
    with path.open('w') as handle:
        for n, message in enumerate(messages):
            obj = {'type': message.get('role', 'user'), 'sessionId': session,
                'uuid': message.get('id', session + str(n)),
                'timestamp': message.get('date', '2026-09-01T10:00:00Z'), 'cwd': '/synthetic/project',
                'message': {'role': message.get('role', 'user'), 'content': [{'type': 'text', 'text': message['text']}]}}
            obj.update(message.get('extra', {}))
            handle.write(json.dumps(obj) + '\n')
    return path


def repeated(tmp_path, conflict=False):
    source = tmp_path / 'history'
    claude(source / 'one.jsonl', [
        {'role': 'assistant', 'text': 'What checks should I run for this small CSV report?'},
        {'text': 'Please validate the CSV headers, count the rows, and write a summary for report.csv.', 'date': '2026-09-01T10:01:00Z'},
        {'role': 'assistant', 'text': 'I will inspect the selected file and report the counts.'}])
    claude(source / 'two.jsonl', [
        {'text': 'Please validate the CSV headers, count the rows, and write a summary for weekly.csv.', 'date': '2026-09-02T10:00:00Z'}])
    if conflict:
        claude(source / 'exception.jsonl', [{'text': 'Do not count the CSV rows for this large archive; only validate the headers.', 'date': '2026-09-03T10:00:00Z'}])
    return source


def test_recall_sources_immutable_precise_citations_and_no_sync(tmp_path):
    source = repeated(tmp_path)
    before = {p: p.read_bytes() for p in source.glob('*.jsonl')}
    home = tmp_path / 'private'
    first = history.index(home, [source])
    assert first['inserted_turns'] == 4
    second = history.index(home, [source])
    assert second['unchanged_files'] == 2
    result = history.search(home, 'CSV headers', role='user')
    assert len(result['results']) == 2
    citation = result['results'][1]
    src = citation['source']
    assert src['line'] == 2
    raw = Path(src['path']).read_bytes()[src['byte_start']:src['byte_end']]
    assert hashlib.sha256(raw).hexdigest() == src['sha256']
    assert citation['context'][0]['role'] == 'assistant'
    assert history.show(home, citation['id'])['source_status'] == 'unchanged'
    assert {p: p.read_bytes() for p in source.glob('*.jsonl')} == before
    assert set(p.name for p in home.iterdir()) == {'recall'}


def test_vibecheck_cited_scope_dates_context_and_concrete_next_action(tmp_path):
    source = repeated(tmp_path)
    report = history.scan(tmp_path / 'private', [source])
    assert len(report['findings']) == 1
    finding = report['findings'][0]
    assert finding['next_action']['item'] == 'loops'
    assert finding['date_range']['start'] == '2026-09-01T10:01:00Z'
    assert finding['date_range']['end'] == '2026-09-02T10:00:00Z'
    assert finding['scope'] == ['/synthetic/project']
    assert finding['uncertainty']
    assert len(finding['citations']) == 2
    assert report['coverage']['human_turns'] == 2
    assert Path(report['handoff_path']).is_file()
    handoff = history.handoff(tmp_path / 'private', report['id'])
    assert 'normal handling and usage' in handoff
    assert 'untrusted historical data' in handoff
    assert 'current model' in handoff
    assert not any(key in finding for key in ('grade', 'percentile', 'score'))


def test_conflicting_history_surfaces_exception_not_universal_preference(tmp_path):
    report = history.scan(tmp_path / 'private', [repeated(tmp_path, conflict=True)])
    finding = report['findings'][0]
    assert finding['status'] == 'needs-context'
    assert len(finding['exceptions']) == 1
    exception = next(e for e in report['evidence'] if e['id'] == finding['exceptions'][0])
    assert 'Do not' in exception['quote']
    assert 'contradictions' in finding['uncertainty']


def test_scope_does_not_leak_earlier_selected_source(tmp_path):
    home = tmp_path / 'private'
    history.scan(home, [repeated(tmp_path)])
    empty = tmp_path / 'empty'
    empty.mkdir()
    report = history.scan(home, [empty])
    assert report['findings'] == []
    assert report['evidence'] == []
    other = claude(tmp_path / 'other' / 'one.jsonl', [{'text': 'Please inspect the schema before implementing this migration.'}])
    report = history.scan(home, [other])
    assert report['findings'] == []
    assert len(report['evidence']) == 1
    result = history.search(home, 'CSV', sources=[empty])
    assert not result['results']


def test_date_selection_is_inclusive_and_no_guess_for_missing_date(tmp_path):
    source = repeated(tmp_path)
    report = history.scan(tmp_path / 'private', [source], since='2026-09-02', until='2026-09-02')
    assert report['coverage']['human_turns'] == 1
    assert not report['findings']
    with pytest.raises(ValueError, match='Dates'):
        history.scan(tmp_path / 'private', [source], since='yesterday')
    with pytest.raises(ValueError, match='later'):
        history.scan(tmp_path / 'private', [source], since='2026-09-04', until='2026-09-01')


def test_forks_metadata_assistants_bare_yes_and_malformed_do_not_establish_repeats(tmp_path):
    root = tmp_path / 'history'
    text = 'Please run the report checks and write a short summary.'
    one = claude(root / 'one.jsonl', [
        {'text': text, 'id': 'original'},
        {'role': 'assistant', 'text': 'I suggest always running these report checks.'},
        {'text': 'yes'},
        {'text': '<environment_context>Always run the report checks with every turn.</environment_context>'},
        {'text': text, 'extra': {'isMeta': True}},
        {'text': text, 'extra': {'isSidechain': True}}])
    claude(root / 'fork.jsonl', [{'text': text, 'id': 'original'}], session='fork-session')
    with one.open('a') as handle:
        handle.write('{malformed\n42\n')
    report = history.scan(tmp_path / 'private', [root])
    assert report['findings'] == []
    assert report['coverage']['human_turns'] == 2  # original + contextual yes
    assert report['coverage']['indexed']['duplicate_turns'] == 1
    assert report['coverage']['indexed']['malformed_lines'] == 2
    assert not any('environment_context' in e['quote'] for e in report['evidence'])


def test_codex_session_context_dedup_event_and_missing_native_ids(tmp_path):
    root = tmp_path / 'history'
    root.mkdir()
    message = {'timestamp': '2026-09-01T09:00:00Z', 'type': 'response_item', 'payload': {
        'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': 'Please inspect the CSV schema and summarize the file.'}]}}
    for name in ('original', 'fork'):
        lines = [{'type': 'session_meta', 'payload': {'id': name, 'cwd': '/synthetic/codex'}}, message,
                 {'type': 'event_msg', 'payload': {'type': 'user_message', 'message': message['payload']['content'][0]['text']}}]
        (root / (name + '.jsonl')).write_text(''.join(json.dumps(x) + '\n' for x in lines))
    report = history.scan(tmp_path / 'private', [root])
    assert report['coverage']['human_turns'] == 1
    assert not report['findings']
    assert report['evidence'][0]['scope'] == '/synthetic/codex'
    assert report['evidence'][0]['provider'] == 'codex'


def test_rewrite_and_partial_lines_keep_citations_honest(tmp_path):
    path = claude(tmp_path / 'source' / 'one.jsonl', [{'text': 'Original task description.', 'id': 'one'}])
    home = tmp_path / 'private'
    history.index(home, [path])
    citation = history.search(home, 'Original')['results'][0]['id']
    content = path.read_text().replace('Original', 'Replaced')
    path.write_text(content)  # same-size in-place rewrite
    assert history.show(home, citation)['source_status'].startswith('changed')
    history.index(home, [path])
    assert not history.search(home, 'Original')['results']
    assert history.search(home, 'Replaced')['results'][0]['source']['revision'] == 2
    partial = json.dumps({'type': 'user', 'sessionId': 'one', 'uuid': 'two', 'message': {'role': 'user', 'content': 'Incomplete source turn'}})
    with path.open('a') as handle:
        handle.write(partial)
    history.index(home, [path])
    assert not history.search(home, 'Incomplete')['results']
    with path.open('a') as handle:
        handle.write('\n')
    history.index(home, [path])
    assert history.search(home, 'Incomplete')['results']


def agent_payload(report):
    found = report['findings'][0]
    return {'findings': [{key: found[key] for key in ('title','observation','citations','exceptions','uncertainty','next_action')}]}


def test_agent_import_validates_sources_and_preserves_corrections(tmp_path):
    home = tmp_path / 'private'
    report = history.scan(home, [repeated(tmp_path)])
    payload = agent_payload(report)
    payload['findings'][0]['observation'] = 'A CSV audit appears in two independent sessions; the inputs differ.'
    imported = history.import_report(home, report['id'], payload)
    assert imported['origin'] == 'validated-agent-import'
    assert imported['findings'][0]['scope'] == ['/synthetic/project']
    fid = imported['findings'][0]['id']
    corrected = history.revise(home, report['id'], fid, text='Use this only for monthly reporting.')
    assert corrected['findings'][0]['user_correction'].startswith('Use this only')
    dismissed = history.revise(home, report['id'], fid, text='These examples are obsolete.', dismiss=True)
    assert dismissed['findings'][0]['status'] == 'dismissed'
    assert len(dismissed['corrections']) == 3
    assert len(dismissed['evidence']) == len(report['evidence'])


@pytest.mark.parametrize('mutation', ['fake', 'single', 'extra', 'too-many', 'assistant'])
def test_agent_import_rejects_forged_weak_and_unknown_reports(tmp_path, mutation):
    home = tmp_path / 'private'
    report = history.scan(home, [repeated(tmp_path)])
    payload = agent_payload(report)
    if mutation == 'fake':
        payload['findings'][0]['citations'].append('turn_fiction')
    elif mutation == 'single':
        payload['findings'][0]['citations'] = payload['findings'][0]['citations'][:1]
    elif mutation == 'extra':
        payload['findings'][0]['grade'] = 'A'
    elif mutation == 'too-many':
        payload['findings'] *= 4
    else:
        payload['findings'][0]['next_action'] = {'item': 'remote-model', 'action': 'upload everything'}
    with pytest.raises(ValueError):
        history.import_report(home, report['id'], payload)
    assert history.inspect_report(home, report['id'])['origin'] == 'deterministic-local-scan'


def test_reject_derived_storage_in_source_or_repository_and_symlinks(tmp_path):
    source = repeated(tmp_path)
    with pytest.raises(ValueError, match='outside the selected'):
        history.index(source / 'derived', [source])
    repo = tmp_path / 'repo'
    (repo / '.git').mkdir(parents=True)
    with pytest.raises(ValueError, match='outside Git'):
        history.index(repo / 'private', [source])
    symlink = tmp_path / 'source-link'
    symlink.symlink_to(source, target_is_directory=True)
    with pytest.raises(ValueError, match='symlink'):
        history.index(tmp_path / 'private', [symlink])


def test_unsupported_client_and_secret_redaction(tmp_path):
    root = tmp_path / 'history'
    root.mkdir()
    (root / 'cursor.json').write_text('{"cursor": "unsupported"}')
    report = history.scan(tmp_path / 'private', [root / 'cursor.json'])
    assert not report['findings']
    assert 'only native' in report['scope']['excluded'][0]['reason']
    secret = 'sk-proj-' + 'a' * 30
    path = claude(root / 'session.jsonl', [{'text': 'Please inspect this selected file with token ' + secret}])
    history.index(tmp_path / 'private', [path])
    result = history.search(tmp_path / 'private', 'selected')
    assert secret not in json.dumps(result)
    assert secret in path.read_text()


def test_cli_paths_errors_and_empty_results(tmp_path, capsys):
    home = tmp_path / 'private'
    assert history.recall_main(['search', 'something'], home) == 0
    assert json.loads(capsys.readouterr().out)['results'] == []
    assert history.recall_main(['index', '--source', str(tmp_path / 'absent')], home) == 2
    assert 'does not exist' in capsys.readouterr().err
    assert history.vibecheck_main(['scan', '--source', str(repeated(tmp_path))], home) == 0
    report = json.loads(capsys.readouterr().out)
    assert history.vibecheck_main(['inspect', report['id']], home) == 0
    assert json.loads(capsys.readouterr().out)['id'] == report['id']
    assert history.vibecheck_main(['inspect', '../../oops'], home) == 2
    assert 'Invalid report ID' in capsys.readouterr().err


def test_public_flagship_fixture_has_real_candidates_and_contextual_exceptions(tmp_path):
    root = Path(__file__).resolve().parents[1] / 'demo/fixtures'
    report = history.scan(tmp_path / 'private', sorted(root.glob('sample-flagship-*.jsonl')))
    assert {f['next_action']['item'] for f in report['findings']} == {'loops', 'pop'}
    assert all(len(f['citations']) == 2 and len(f['exceptions']) == 1 for f in report['findings'])
    loops = next(f for f in report['findings'] if f['next_action']['item'] == 'loops')
    evidence = {e['id']: e for e in report['evidence']}
    assert all('manifest.json' in evidence[c]['quote'] for c in loops['citations'])
    assert 'note-only' in evidence[loops['exceptions'][0]]['quote']


def test_compaction_synthetic_and_unclosed_injected_wrappers_are_not_human_patterns(tmp_path):
    root = tmp_path / 'history'
    for name in ('one', 'two'):
        claude(root / (name + '.jsonl'), [
            {'text': 'Repeated summary says the user always wants a new report.', 'extra': {'isCompactSummary': True}},
            {'text': 'Repeated generated instruction asks for a short report.', 'extra': {'isSynthetic': True}},
            {'text': '<environment_context>This generated setup asks for the same repeated report'},
            {'text': '<skills_instructions>Always inspect the report before giving an answer</skills_instructions>'},
            {'text': 'This session is being continued from a previous conversation that ran out of context. The user wants a report.'}])
    report = history.scan(tmp_path / 'private', [root])
    assert not report['findings']
    assert report['coverage']['human_turns'] == 0


def test_missing_or_invalid_date_is_reported_without_inventing_a_date(tmp_path):
    source = claude(tmp_path / 'history' / 'one.jsonl', [
        {'text': 'Please inspect the selected release files and summarize what you found.', 'date': 'unknown-date'}])
    report = history.scan(tmp_path / 'private', [source])
    assert report['coverage']['missing_dates'] == 1
    assert report['evidence'][0]['date'] is None
    dated = history.scan(tmp_path / 'private', [source], since='2026-01-01')
    assert dated['evidence'] == []


@pytest.mark.parametrize('linked', ['recall', 'vibecheck', 'vibecheck/reports'])
def test_owned_directory_symlinks_cannot_write_into_source_or_unrelated_directory(tmp_path, linked):
    source = repeated(tmp_path)
    before = {p.name: p.read_bytes() for p in source.iterdir()}
    home = tmp_path / 'private'
    target = home / linked
    target.parent.mkdir(parents=True, exist_ok=True)
    target.symlink_to(source, target_is_directory=True)
    with pytest.raises(ValueError, match='symlink'):
        history.scan(home, [source])
    assert target.is_symlink()
    assert {p.name: p.read_bytes() for p in source.iterdir()} == before
    assert not (home / 'recall/index.sqlite3').exists()


@pytest.mark.parametrize('suffix', ['', '-wal', '-shm', '-journal'])
def test_sqlite_file_and_sidecar_symlinks_preserve_unrelated_database(tmp_path, suffix):
    import sqlite3
    source = repeated(tmp_path)
    home = tmp_path / 'private'
    (home / 'recall').mkdir(parents=True)
    unrelated = tmp_path / 'unrelated.sqlite3'
    with sqlite3.connect(unrelated) as conn:
        conn.execute('CREATE TABLE important (value TEXT)')
        conn.execute("INSERT INTO important VALUES ('preserve this record')")
    before = unrelated.read_bytes()
    target = home / ('recall/index.sqlite3' + suffix)
    target.symlink_to(unrelated)
    with pytest.raises(ValueError, match='symlink'):
        history.index(home, [source])
    assert target.is_symlink()
    assert unrelated.read_bytes() == before
    with sqlite3.connect(unrelated) as conn:
        assert conn.execute('SELECT value FROM important').fetchone()[0] == 'preserve this record'
        assert conn.execute("SELECT name FROM sqlite_master WHERE name='turns'").fetchone() is None


def test_sqlite_hardlink_cannot_mutate_another_database(tmp_path):
    import os
    import sqlite3
    source = repeated(tmp_path)
    home = tmp_path / 'private'
    (home / 'recall').mkdir(parents=True)
    unrelated = tmp_path / 'unrelated.sqlite3'
    with sqlite3.connect(unrelated) as conn:
        conn.execute('CREATE TABLE important (value TEXT)')
    before = unrelated.read_bytes()
    os.link(unrelated, home / 'recall/index.sqlite3')
    with pytest.raises(ValueError, match='hard-linked'):
        history.index(home, [source])
    assert unrelated.read_bytes() == before


def test_linked_existing_report_and_handoff_preserve_external_contents(tmp_path):
    home = tmp_path / 'private'
    report = history.scan(home, [repeated(tmp_path)])
    original = Path(report['report_path'])
    saved = original.with_suffix('.preserved.json')
    original.rename(saved)
    unrelated = tmp_path / 'unrelated.txt'
    unrelated.write_text('Keep this independent file.\n')
    original.symlink_to(unrelated)
    with pytest.raises(ValueError, match='symlink'):
        history.inspect_report(home, report['id'])
    with pytest.raises(ValueError, match='symlink'):
        history.revise(home, report['id'], report['findings'][0]['id'], text='Changed wording')
    assert unrelated.read_text() == 'Keep this independent file.\n'
    assert saved.is_file()
    handoff = Path(report['handoff_path'])
    handoff.rename(handoff.with_suffix('.preserved.md'))
    handoff.symlink_to(unrelated)
    with pytest.raises(ValueError, match='symlink'):
        history._write(handoff, 'do not overwrite the target', home=home)
    assert unrelated.read_text() == 'Keep this independent file.\n'


def test_symlinked_home_is_not_resolved_into_source_storage(tmp_path):
    source = repeated(tmp_path)
    home = tmp_path / 'private-link'
    home.symlink_to(source, target_is_directory=True)
    with pytest.raises(ValueError, match='symlink'):
        history.index(home, [source])
    assert not (source / 'recall').exists()
