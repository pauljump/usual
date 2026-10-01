"""`usual learn …` and `usual playbook …`. One private store, shared by Codex and Claude Code."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3
import sys

from .learn import AGENTS, OUTCOMES, VERDICTS, Learn, parse_check


def _selection(learn, args):
    path = learn.path.parent / 'sources.json'
    chosen = {'transcripts': [], 'docs': []}
    if args.provider:
        home = Path.home()
        if args.provider in ('claude', 'both'):
            chosen['transcripts'].append(['claude', str(home / '.claude/projects')])
        if args.provider in ('codex', 'both'):
            chosen['transcripts'] += [['codex', str(home / '.codex/sessions')], ['codex', str(home / '.codex/archived_sessions')]]
    for value in args.source:
        provider, _, where = value.partition('=')
        if provider not in ('claude', 'codex') or not where:
            raise ValueError('--source takes claude=PATH or codex=PATH')
        chosen['transcripts'].append([provider, str(Path(where).expanduser())])
    for value in args.docs:
        kind, _, where = value.partition('=')
        if kind not in ('memory', 'handoff', 'playbook', 'contract', 'notes') or not where:
            raise ValueError('--docs takes memory|handoff|playbook|contract|notes=PATH_OR_GLOB')
        chosen['docs'].append([kind, str(Path(where).expanduser())])
    if chosen['transcripts'] or chosen['docs']:
        if not args.dry_run:
            path.write_text(json.dumps(chosen, indent=2) + '\n')
            path.chmod(0o600)
        return chosen, 'selected now and saved for later refreshes'
    if path.is_file():
        return json.loads(path.read_text()), 'saved selection'
    raise ValueError('Choose history explicitly the first time: --provider claude|codex|both, --source, and/or --docs')


def learn_main(argv, home):
    p = argparse.ArgumentParser(prog='usual learn', description='Learn from selected local work; assess what it learned. No model calls.')
    sub = p.add_subparsers(dest='command', required=True)
    ing = sub.add_parser('ingest', help='Incremental, resumable indexing of selected transcripts and notes')
    ing.add_argument('--provider', choices=['claude', 'codex', 'both'])
    ing.add_argument('--source', action='append', default=[], help='claude=PATH or codex=PATH (file or directory)')
    ing.add_argument('--docs', action='append', default=[], help='KIND=PATH_OR_GLOB; KIND is memory|handoff|playbook|contract|notes')
    ing.add_argument('--max-files', type=int)
    ing.add_argument('--max-seconds', type=float)
    ing.add_argument('--dry-run', action='store_true')
    ing.add_argument('--force', action='store_true', help='Re-parse unchanged files (after a parser change)')
    ext = sub.add_parser('extract', help='Deterministic candidate observations from the indexes')
    ext.add_argument('--choices-db', default=str(Path.home() / '.usual/judgment.sqlite3'))
    ext.add_argument('--since')
    ext.add_argument('--limit-per-kind', type=int, default=12)
    sub.add_parser('candidates').add_argument('--limit', type=int, default=40)
    hand = sub.add_parser('handoff', help='Bounded packet for the current agent to interpret')
    hand.add_argument('--limit', type=int, default=8)
    hand.add_argument('--out')
    hand.add_argument('--candidate', action='append', default=[], help='Interpret these candidates instead of the top-priority ones')
    interp = sub.add_parser('interpret', help='Import the current agent\'s validated interpretation')
    interp.add_argument('--file', required=True)
    interp.add_argument('--agent', choices=AGENTS, required=True)
    sub.add_parser('queue').add_argument('--limit', type=int, default=10)
    sub.add_parser('show').add_argument('id')
    ans = sub.add_parser('answer', help='Record an answer the user explicitly gave in conversation')
    ans.add_argument('id')
    ans.add_argument('--verdict', choices=VERDICTS, required=True)
    ans.add_argument('--choice', type=int)
    ans.add_argument('--statement', default='')
    ans.add_argument('--scope', default='')
    ans.add_argument('--note', default='')
    ans.add_argument('--confirm-user-review', action='store_true')
    undo = sub.add_parser('undo')
    undo.add_argument('learning')
    undo.add_argument('--confirm-user-review', action='store_true')
    ui = sub.add_parser('review-ui', help='Private loopback assessment and playbook review')
    ui.add_argument('--port', type=int, default=0)
    sub.add_parser('status')
    sub.add_parser('metrics')
    args = p.parse_args(argv)
    learn = Learn(home)
    if args.command == 'ingest':
        chosen, origin = _selection(learn, args)
        result = learn.ingest([tuple(x) for x in chosen['transcripts']], [tuple(x) for x in chosen['docs']],
                              max_files=args.max_files, max_seconds=args.max_seconds, dry_run=args.dry_run, force=args.force)
        result['selection'] = {'origin': origin, **chosen}
    elif args.command == 'extract':
        from .learn_extract import extract
        result = extract(learn, choices_db=args.choices_db, since=args.since, limit_per_kind=args.limit_per_kind)
    elif args.command == 'candidates':
        result = learn.candidates(limit=args.limit)
    elif args.command == 'handoff':
        result = learn.handoff(args.limit, ids=args.candidate or None)
        if args.out:
            out = Path(args.out).expanduser()
            out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
            out.chmod(0o600)
            result = {'written': str(out), 'candidates': len(result['candidates']), 'privacy': 'Private evidence; keep outside repositories.'}
    elif args.command == 'interpret':
        path = Path(args.file).expanduser()
        if path.stat().st_size > 512 * 1024:
            raise ValueError('Interpretation file exceeds 512 KiB')
        result = learn.interpret(json.loads(path.read_text()), args.agent)
    elif args.command == 'queue':
        result = learn.queue(args.limit)
    elif args.command == 'show':
        result = learn.item(args.id)
    elif args.command in ('answer', 'undo'):
        if not args.confirm_user_review:
            raise ValueError('Human review is required. Use `usual learn review-ui`, or pass --confirm-user-review only for an answer the user explicitly gave now.')
        if args.command == 'answer':
            item = learn.item(args.id)
            result = learn.answer(args.id, args.verdict, revision=item['learning']['revision'], choice=args.choice,
                                  statement=args.statement, scope=args.scope, note=args.note, channel='cli-confirmed')
        else:
            current = learn.learning(args.learning)
            result = learn.undo(args.learning, revision=current['revision'], channel='cli-confirmed')
    elif args.command == 'review-ui':
        from .learn_server import serve
        serve(learn, args.port)
        return None
    elif args.command == 'status':
        result = learn.status()
    else:
        result = learn.metrics()
    return result


def playbook_main(argv, home):
    p = argparse.ArgumentParser(prog='usual playbook', description='Reviewed playbooks shared by Codex and Claude Code')
    sub = p.add_subparsers(dest='command', required=True)
    find = sub.add_parser('find', help='Check for a reviewed prior solution before investigating')
    find.add_argument('query')
    find.add_argument('--project')
    find.add_argument('--agent', choices=AGENTS, default='other')
    find.add_argument('--limit', type=int, default=3)
    find.add_argument('--history', action='store_true', help='Also show up to three cited Recall matches')
    sub.add_parser('list')
    show = sub.add_parser('show')
    show.add_argument('slug')
    show.add_argument('--version', type=int)
    show.add_argument('--format', choices=['json', 'markdown'], default='markdown')
    sub.add_parser('template').add_argument('--learning', action='append', required=True)
    draft = sub.add_parser('draft', help='Draft from user-reviewed learnings; stays unreviewed until approved')
    draft.add_argument('slug')
    draft.add_argument('--file', required=True)
    draft.add_argument('--learning', action='append', required=True)
    draft.add_argument('--note', default='')
    rev = sub.add_parser('review', help='Record the user\'s explicit playbook review')
    rev.add_argument('version_id')
    rev.add_argument('--verdict', choices=['approve', 'reject', 'narrow', 'edit', 'edit-and-approve'], required=True)
    rev.add_argument('--project', action='append', default=[])
    rev.add_argument('--scope-note', default='')
    rev.add_argument('--file', help='Edited body JSON (edit verdicts)')
    rev.add_argument('--note', default='')
    rev.add_argument('--confirm-user-review', action='store_true')
    sub.add_parser('diff').add_argument('version_id')
    use = sub.add_parser('use', help='Start following an approved playbook')
    use.add_argument('slug')
    use.add_argument('--agent', choices=AGENTS, required=True)
    use.add_argument('--task', required=True)
    use.add_argument('--project')
    use.add_argument('--trial', action='store_true', help='Try an unreviewed draft; never counts as approval')
    ver = sub.add_parser('verify', help='Run read-only checks (usual_executed) or record an agent report')
    ver.add_argument('use')
    ver.add_argument('--check', action='append', default=[], help='http:URL[=CODE] | port:N[=LISTENERS] | file:PATH')
    ver.add_argument('--declared', action='store_true', help='Run the playbook\'s declared checks')
    ver.add_argument('--input', action='append', default=[], help='name=value for declared-check placeholders')
    ver.add_argument('--reported')
    group = ver.add_mutually_exclusive_group()
    group.add_argument('--passed', action='store_true', default=None)
    group.add_argument('--failed', action='store_true')
    fin = sub.add_parser('finish')
    fin.add_argument('use')
    fin.add_argument('--outcome', choices=OUTCOMES, required=True)
    fin.add_argument('--deviation', action='append', default=[])
    fin.add_argument('--notes', default='')
    sub.add_parser('improve').add_argument('slug')
    revise = sub.add_parser('revise', help='Propose a revision (a new draft) for review')
    revise.add_argument('slug')
    revise.add_argument('--file', required=True)
    revise.add_argument('--note', required=True)
    for name in ('retire', 'rollback'):
        r = sub.add_parser(name)
        r.add_argument('slug')
        r.add_argument('--confirm-user-review', action='store_true')
        if name == 'retire':
            r.add_argument('--reason', required=True)
        else:
            r.add_argument('--to', type=int, required=True)
            r.add_argument('--note', default='')
    args = p.parse_args(argv)
    learn = Learn(home)
    read = lambda f: json.loads(Path(f).expanduser().read_text())
    if args.command == 'find':
        if not 1 <= args.limit <= 5:
            raise ValueError('Limit must be 1-5')
        return learn.find(args.query, project=args.project, agent=args.agent, limit=args.limit, include_history=args.history)
    if args.command == 'list':
        return learn.playbooks()
    if args.command == 'show':
        version = learn.version(slug=args.slug, number=args.version)
        if args.format == 'markdown':
            print(version['markdown'])
            return None
        return version
    if args.command == 'template':
        return learn.template(args.learning)
    if args.command == 'draft':
        return learn.draft(args.slug, read(args.file), args.learning, change_note=args.note)
    if args.command == 'review':
        if not args.confirm_user_review:
            raise ValueError('Human review is required. Use `usual learn review-ui`, or pass --confirm-user-review only for a verdict the user explicitly gave now.')
        scope = {'projects': args.project, 'note': args.scope_note} if args.verdict == 'narrow' else None
        body = read(args.file) if args.file else None
        return learn.review_playbook(args.version_id, args.verdict, body=body, scope=scope, note=args.note, channel='cli-confirmed')
    if args.command == 'diff':
        version = learn.version(args.version_id)
        print(version['diff'] or 'No parent version to compare.')
        return None
    if args.command == 'use':
        return learn.use(args.slug, args.agent, args.task, args.project, trial=args.trial)
    if args.command == 'verify':
        inputs = dict(x.split('=', 1) for x in args.input)
        passed = None if args.reported is None else (False if args.failed else True if args.passed else None)
        return learn.verify(args.use, [parse_check(c) for c in args.check], declared=args.declared, inputs=inputs,
                            reported=args.reported, passed=passed)
    if args.command == 'finish':
        return learn.finish_use(args.use, args.outcome, deviations=args.deviation, notes=args.notes)
    if args.command == 'improve':
        return learn.improve(args.slug)
    if args.command == 'revise':
        return learn.revise(args.slug, read(args.file), change_note=args.note)
    if not args.confirm_user_review:
        raise ValueError('This changes a standing procedure; pass --confirm-user-review only when the user asked for it now.')
    if args.command == 'retire':
        return learn.retire(args.slug, args.reason)
    return learn.rollback(args.slug, args.to, note=args.note)


def main(command, argv, home):
    try:
        result = (learn_main if command == 'learn' else playbook_main)(argv, home)
    except (ValueError, OSError, KeyError, sqlite3.Error, json.JSONDecodeError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        return 2
    if result is not None:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0
