"""Recall MCP over stdio, using synthetic native-history fixtures only."""
import io
import json

from usual import mcp_server
from test_collection_history import claude


def call(recall, *messages):
    out = io.StringIO()
    lines = [json.dumps({'jsonrpc': '2.0', 'id': n, **m}) for n, m in enumerate(messages, 1)]
    mcp_server.serve(recall, io.StringIO('\n'.join(lines) + '\n'), out)
    return [json.loads(line) for line in out.getvalue().splitlines()]


def tool(name, **args):
    return {'method': 'tools/call', 'params': {'name': name, 'arguments': args}}


def test_mcp_indexes_new_files_and_answers_across_tools(tmp_path):
    source = tmp_path / 'history'
    claude(source / 'one.jsonl', [
        {'text': 'Build the tide chart widget with a cloudflare tunnel.'},
        {'role': 'assistant', 'text': 'Tide chart widget is live behind the tunnel.', 'date': '2026-09-01T10:02:00Z'}])
    (source / 'subagents').mkdir()
    claude(source / 'subagents' / 'agent-x.jsonl', [{'text': 'subagent tide chatter'}])
    recall = mcp_server.Recall(tmp_path / 'private', [source], refresh_seconds=0)

    init, listed, found, sessions = call(recall, {'method': 'initialize', 'params': {}}, {'method': 'tools/list'},
                                         tool('search_history', query='tide chart'), tool('list_sessions'))
    assert init['result']['serverInfo']['name'] == 'usual-recall'
    assert {t['name'] for t in listed['result']['tools']} >= {'search_history', 'list_sessions', 'read_session'}
    text = found['result']['content'][0]['text']
    assert text.startswith('2 result(s)') and 'subagent' not in text
    listing = sessions['result']['content'][0]['text']
    assert '1 session(s)' in listing and 'Build the tide chart widget' in listing
    session_id = listing.split('\n- ')[1].split(' |')[0]

    claude(source / 'two.jsonl', [{'text': 'Rename the tide chart to swell chart.', 'date': '2026-09-02T09:00:00Z'}])
    (read,) = call(recall, tool('search_history', query='swell'))
    assert read['result']['content'][0]['text'].startswith('1 result(s)')

    (page,) = call(recall, tool('read_session', session_id=session_id, include_assistant=False))
    body = page['result']['content'][0]['text']
    assert 'USER: Build the tide chart' in body and 'AGENT' not in body


def test_mcp_reports_tool_errors_without_crashing(tmp_path):
    recall = mcp_server.Recall(tmp_path / 'private', [tmp_path], refresh_seconds=0)
    bad, unknown = call(recall, tool('read_session', session_id='nope'), tool('rm_rf'))
    assert bad['result']['isError'] and 'Unknown session' in bad['result']['content'][0]['text']
    assert unknown['error']['code'] == -32602
