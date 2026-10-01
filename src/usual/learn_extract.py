"""Deterministic candidate extraction for Learn. No model calls; every candidate cites sources.

Candidates are observations ("X appears in N sessions across M projects"), never preferences.
The current coding agent interprets a bounded packet of them; the user assesses the result.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import json
import math
from pathlib import Path
import re
import sqlite3

from . import history
from .learn import PROJECT_PATH, STOP, project_of, stable_id

KIND_WEIGHT = {'conflict': 1.3, 'recurring_problem': 1.2, 'failed_then_worked': 1.1, 'correction': 1.0,
               'procedure': 0.9, 'decision': 0.8}

SIGNATURES = [
    (re.compile(r'\bE(ADDRINUSE|CONNREFUSED|CONNRESET|ACCES|NOSPC|MFILE|TIMEDOUT)\b'), lambda m: 'E' + m.group(1)),
    (re.compile(r'\baddress already in use\b|\bport \d{2,5} (?:is )?(?:already )?in use\b', re.I), lambda m: 'EADDRINUSE'),
    (re.compile(r'\bno space left on device\b|\bdisk (?:is )?full\b', re.I), lambda m: 'ENOSPC'),
    (re.compile(r'\b(50[234])\b(?=[^\n]{0,30}\b(?:bad gateway|error|gateway|unavailable|timeout|outage)\b)|\b(?:bad gateway|returns?|returned|got an?|HTTP|status)\s+(50[234])\b', re.I),
     lambda m: 'HTTP ' + (m.group(1) or m.group(2))),
    (re.compile(r'\b(?:crash[- ]?loop(?:ing)?|restart loop|restart(?:ing)? repeatedly)\b', re.I), lambda m: 'crash loop'),
    (re.compile(r'\bdatabase is locked\b', re.I), lambda m: 'sqlite database is locked'),
    (re.compile(r'\b(ModuleNotFoundError|UnicodeDecodeError|ConnectionRefusedError|PermissionError)\b'), lambda m: m.group(1)),
    (re.compile(r'\bhydration (?:error|mismatch|failed)\b', re.I), lambda m: 'hydration error'),
    (re.compile(r'\bCORS\b(?=[^\n]{0,40}\b(?:error|blocked|policy|header)\b)'), lambda m: 'CORS error'),
    (re.compile(r'\b(?:rate[- ]limit(?:ed)?|HTTP 429|429 too many)\b', re.I), lambda m: 'rate limit'),
    (re.compile(r'\berror 10(?:33|16)\b|\bcloudflared\b(?=[^\n]{0,40}\b(?:down|disconnect|reconnect|error|failed)\b)', re.I), lambda m: 'Cloudflare tunnel error'),
    (re.compile(r'\bTestFlight\b(?=[^\n]{0,80}\b(?:expired|not available|missing|stuck|invalid)\b)', re.I), lambda m: 'TestFlight build unavailable'),
    (re.compile(r'\b(?:provisioning profile|code ?signing)\b(?=[^\n]{0,60}\b(?:error|fail|invalid|missing|expired)\b)', re.I), lambda m: 'iOS signing error'),
    (re.compile(r'\bpush protection\b|\bsecret scanning\b(?=[^\n]{0,40}\bblock)', re.I), lambda m: 'GitHub push protection'),
    (re.compile(r'\bnon-fast-forward\b|\bdivergent branches\b', re.I), lambda m: 'git branches diverged'),
    (re.compile(r'\bmerge conflict|\bstash pop\b(?=[^\n]{0,30}\bconflict)', re.I), lambda m: 'git conflict'),
    (re.compile(r'\bout of memory\b|\bJavaScript heap\b|\bOOM\b'), lambda m: 'out of memory'),
    (re.compile(r'\borphan(?:ed)? (?:process|server|node|python)\b|\bsplit[- ]brain\b', re.I), lambda m: 'orphan process holds port'),
    (re.compile(r'\bstale (?:build|bundle|cache|\.next)\b|\bcache[- ]bust', re.I), lambda m: 'stale build or cache'),
    (re.compile(r'\bsession limit\b|\busage limit\b', re.I), lambda m: 'agent session/usage limit'),
]
CORRECTION = re.compile(r"^\s*(?:no[,.! ]|nope\b|don'?t\b|do not\b|stop\b|wait[,.! ]|wrong\b|that'?s (?:not|wrong)\b|not what\b|"
                        r"actually[, ]|instead\b|why (?:did|are|would|is) (?:you|it|this)\b|i (?:said|asked|told)\b|never\b|"
                        r"please don'?t\b|you (?:didn'?t|shouldn'?t|should not|forgot)\b|that'?s not\b)", re.I)
FAILURE = re.compile(r"\b(?:still (?:broken|failing|fails|not working|doesn'?t work|getting|seeing|the same|down|erroring)|"
                     r"(?:doesn'?t|didn'?t|isn'?t|is not|does not) work|not working|same (?:error|problem|issue)|broken again|"
                     r"it'?s (?:still )?broken|nothing (?:changed|happens)|still (?:a )?50[0-4])\b", re.I)
SUCCESS = re.compile(r"\b(?:works now|it works|that worked|that fixed it|fixed it|working now|it'?s working|perfect|"
                     r"that did it|all good now|back up)\b", re.I)
RESOLVED = re.compile(r"\b(?:root cause|the cause (?:is|was)|was caused by|caused by|fixed|resolved|now returns? (?:HTTP )?200|"
                      r"is holding|held by|killed (?:the )?(?:orphan|stale)|works now)\b", re.I)
INJECTED = re.compile(r'\s*(?:The following is the Codex agent history|<codex_internal_context|<codex_delegation|<in-app-browser-context|<turn_aborted)')
CORRECTION_STOP = STOP | set("don't dont stop wrong actually instead never said asked told why you're that's isn't wasn't "
                             "should shouldn't would want wanted need needed just like think saying doing thing work works "
                             "working make made time also still wait sorry mean means meant".split())


def iso_day(value):
    return (value or '')[:10] or None


def recent(day, days=30):
    if not day:
        return False
    return day >= (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()


def base_priority(kind, sessions, projects, last_day, contrary=False):
    return round(KIND_WEIGHT[kind] * (min(projects, 6) + math.log2(1 + sessions)) * (1.0 if recent(last_day) else 0.6)
                 * (1.25 if contrary else 1.0), 3)


def _terms(text, stop=CORRECTION_STOP):
    return {t for t in re.findall(r"[a-z][a-z0-9_.-]{3,}", text.lower()) if t not in stop and not t.endswith('.')}


def clusters(records, *, min_sessions=2, limit=12, max_share=0.08, background=None, background_total=0, min_lift=2.5):
    """Group records by a shared term that is distinctive for these records, not common in all human text."""
    n = len(records)
    by_term = defaultdict(list)
    for r in records:
        for t in r['terms']:
            by_term[t].append(r)
    if background and background_total:
        for term in list(by_term):
            general = background.get(term, 0) / background_total
            if general > 0.015 or (general and (len(by_term[term]) / max(1, n)) / general < min_lift):
                del by_term[term]
    scored = []
    for term, rows in by_term.items():
        sessions = {r['session'] for r in rows}
        if len(sessions) < min_sessions or len(rows) > max(6, n * max_share):
            continue
        projects = {r['project'] for r in rows if r['project']}
        scored.append((len(sessions) * math.log(1 + n / len(rows)) * (1 + 0.5 * len(projects)), term, rows))
    chosen = []
    for score, term, rows in sorted(scored, key=lambda x: (-x[0], x[1])):
        ids = {r['id'] for r in rows}
        if any(len(ids & c['ids']) / len(ids) >= 0.5 for c in chosen):
            continue
        co = Counter(u for r in rows for u in r['terms'] if u != term)
        label = [term] + [u for u, k in co.most_common(3) if k >= max(2, len(rows) // 2)]
        chosen.append({'term': term, 'label': label, 'ids': ids, 'records': rows, 'score': score})
        if len(chosen) >= limit:
            break
    return chosen


def _signatures(text):
    found = set()
    for pattern, name in SIGNATURES:
        for m in pattern.finditer(text):
            found.add(name(m))
    return found


def _sessions(conn, since=None):
    """Stream current, deduplicated turns grouped by source file (one session per file)."""
    clause = ' AND substr(t.timestamp,1,10) >= ?' if since else ''
    rows = conn.execute('''SELECT t.id, t.role, substr(t.text,1,6000) AS text, t.timestamp, t.provider, o.session_id, o.cwd,
        s.path AS source_path, o.source_line, o.byte_start, o.byte_end, o.raw_sha256, o.source_revision
        FROM turn_sources o JOIN turns t ON t.id=o.turn_id JOIN sources s ON s.id=o.source_id
        WHERE o.source_revision=s.revision''' + clause + ' ORDER BY s.path, o.source_line', (since,) if since else ())
    seen, current, path = set(), [], None
    for row in rows:
        if row['source_path'] != path and current:
            yield current
            current = []
        path = row['source_path']
        if row['id'] in seen:
            continue
        seen.add(row['id'])
        current.append(dict(row))
    if current:
        yield current


def _session_project(turns):
    for t in turns:
        p = project_of(t['cwd'])
        if p:
            return p
    counts = Counter()
    for t in turns:
        for match in PROJECT_PATH.finditer(t['text'][:4000]):
            name = project_of(match.group(0))
            if name:
                counts[name] += 1
    top = counts.most_common(1)
    return top[0][0] if top and top[0][1] >= 2 else None


def _turn_project(turn, session_project):
    match = PROJECT_PATH.search(turn['text'][:3000])
    return (project_of(match.group(0)) if match else None) or session_project


def extract(learn, *, choices_db=None, since=None, limit_per_kind=12):
    """Rebuild candidate observations from the current indexes. Idempotent; stable candidate IDs."""
    conn = history._connect(learn.home)
    sig = defaultdict(list)          # signature -> [(session_key, index, turn, project, prev)]
    sig_sessions = defaultdict(dict)  # signature -> session_key -> {'first','last','project'}
    corrections, human_rows, fixes = [], [], []
    totals, background = Counter(), Counter()
    try:
        for turns in _sessions(conn, since):
            key = turns[0]['source_path']
            project = _session_project(turns)
            totals['sessions'] += 1
            failure_at, active = {}, set()
            for i, turn in enumerate(turns):
                totals['turns'] += 1
                prev = turns[i - 1] if i else None
                if turn['role'] == 'user' and INJECTED.match(turn['text']):
                    turn['role'] = 'injected'  # Provider-generated text logged as a user message.
                    totals['injected_user_turns'] += 1
                if turn['role'] == 'user':
                    totals['human_turns'] += 1
                    human_rows.append(turn)
                    background.update(_terms(turn['text'][:1200]))
                    if prev and prev['role'] == 'assistant' and CORRECTION.search(turn['text'][:200]) and len(turn['text']) < 2500:
                        corrections.append({'id': turn['id'], 'session': key, 'project': _turn_project(turn, project),
                                            'terms': _terms(turn['text'][:1200]), 'turn': turn, 'prev': prev})
                for name in _signatures(turn['text'][:6000]):
                    here = _turn_project(turn, project)
                    entry = sig_sessions[name].setdefault(key, {'first': i, 'last': i, 'project': here, 'human': 0,
                                                                'first_ts': turn['timestamp'], 'last_ts': turn['timestamp']})
                    entry['last'], entry['last_ts'] = i, turn['timestamp'] or entry['last_ts']
                    entry['human'] += turn['role'] == 'user'
                    if len([x for x in sig[name] if x[0] == key]) < 4:
                        sig[name].append((key, i, turn, here, prev))
                    active.add(name)
                if turn['role'] == 'user' and active and FAILURE.search(turn['text'][:1500]):
                    for name in active:
                        failure_at.setdefault(name, (i, turn, prev))
                if turn['role'] == 'user' and SUCCESS.search(turn['text'][:400]) and failure_at:
                    for name, (fi, fturn, fprev) in list(failure_at.items()):
                        if fi < i:
                            fixes.append({'signature': name, 'session': key, 'project': _turn_project(fturn, project),
                                          'failure': (fturn, fprev), 'worked': (turn, prev)})
                            del failure_at[name]
                if turn['role'] == 'assistant' and RESOLVED.search(turn['text'][:3000]):
                    for name in list(sig_sessions):
                        entry = sig_sessions[name].get(key)
                        if entry and 'resolution' not in entry and i > entry['first']:
                            entry['resolution'] = (turn, prev)
                            entry['resolution_index'], entry['resolution_ts'] = i, turn['timestamp']
        created = Counter()
        human_rows = [r for r in human_rows if r['timestamp']]
        with learn.db() as db:
            docs_by_sig = {}
            # ---- recurring problems across projects
            ranked = []
            for name, sessions in sig_sessions.items():
                projects = {v['project'] for v in sessions.values() if v['project']}
                if len(sessions) < 3 or len(projects) < 2:
                    continue
                days = sorted(iso_day(t[2]['timestamp']) for t in sig[name] if t[2]['timestamp'])
                ranked.append((base_priority('recurring_problem', len(sessions), len(projects), days[-1] if days else None), name, sessions, projects, days))
            for priority, name, sessions, projects, days in sorted(ranked, key=lambda x: -x[0])[:limit_per_kind]:
                roles = []
                by_project = {}
                for entry in sorted(sig[name], key=lambda x: x[2]['timestamp'] or '', reverse=True):
                    if entry[2]['role'] != 'user' and any(e[0] == entry[0] and e[2]['role'] == 'user' for e in sig[name]):
                        continue
                    by_project.setdefault(entry[3] or '(unattributed)', []).append(entry)
                picked = []
                while len(picked) < 6 and any(by_project.values()):
                    for p in list(by_project):
                        if by_project[p]:
                            picked.append(by_project[p].pop(0))
                        if len(picked) >= 6:
                            break
                for key, _, turn, here, prev in picked:
                    sid = learn.source_from_turn(db, turn, _ctx(prev), here)
                    roles.append((sid, 'support' if turn['role'] == 'user' else 'context'))
                    resolution = sessions.get(key, {}).get('resolution')
                    if resolution:
                        roles.append((learn.source_from_turn(db, resolution[0], _ctx(resolution[1]), here), 'outcome'))
                roles += _doc_context(learn, db, name, docs_by_sig)
                # Historical effort per session: first mention to the reported resolution (else the last mention).
                turns_spent = [v.get('resolution_index', v['last']) - v['first'] + 1 for v in sessions.values()]
                minutes = [round(_minutes(v['first_ts'], v.get('resolution_ts') or v['last_ts']), 1) for v in sessions.values()
                           if v['first_ts'] and (v.get('resolution_ts') or v['last_ts'])]
                stats = {'sessions': len(sessions), 'projects': sorted(projects), 'first': days[0] if days else None,
                         'last': days[-1] if days else None, 'human_mentions': sum(v['human'] for v in sessions.values()),
                         'investigation_turns': sorted(turns_spent), 'investigation_minutes': sorted(minutes),
                         'sessions_with_reported_resolution': sum('resolution' in v for v in sessions.values())}
                _, new = learn.upsert_candidate(db, 'recurring_problem', name, f'Recurring problem: {name}',
                    f'"{name}" appears in {len(sessions)} sessions across {len(projects)} projects ({", ".join(sorted(projects)[:6])}) '
                    f'between {stats["first"]} and {stats["last"]}. {stats["sessions_with_reported_resolution"]} sessions contain an assistant-reported resolution; '
                    'none is independently verified by this scan.', stats, priority, roles)
                created['recurring_problem'] += new
            # ---- failed approaches followed by a human-reported success
            grouped = defaultdict(list)
            for f in fixes:
                grouped[f['signature']].append(f)
            for name, items in sorted(grouped.items(), key=lambda x: -len(x[1]))[:limit_per_kind]:
                sessions = {f['session'] for f in items}
                if len(sessions) < 2:
                    continue
                projects = {f['project'] for f in items if f['project']}
                roles = []
                for f in items[-4:]:
                    roles.append((learn.source_from_turn(db, f['failure'][0], _ctx(f['failure'][1]), f['project']), 'failure'))
                    worked, before = f['worked']
                    if before and before['role'] == 'assistant':
                        roles.append((learn.source_from_turn(db, before, [], f['project']), 'context'))
                    roles.append((learn.source_from_turn(db, worked, _ctx(before), f['project']), 'outcome'))
                days = sorted(iso_day(f['worked'][0]['timestamp']) for f in items if f['worked'][0]['timestamp'])
                stats = {'sessions': len(sessions), 'projects': sorted(projects), 'first': days[0] if days else None, 'last': days[-1] if days else None}
                _, new = learn.upsert_candidate(db, 'failed_then_worked', name, f'Failed attempts, then a fix: {name}',
                    f'In {len(sessions)} sessions a human reported "{name}" still failing and later reported it working. '
                    'The success is human-reported; what changed must be read from the adjacent assistant turn.',
                    stats, base_priority('failed_then_worked', len(sessions), len(projects), stats['last']), roles)
                created['failed_then_worked'] += new
            # ---- repeated corrections
            for c in clusters(corrections, limit=limit_per_kind, background=background, background_total=totals['human_turns']):
                rows = sorted(c['records'], key=lambda r: r['turn']['timestamp'] or '', reverse=True)[:6]
                projects = {r['project'] for r in c['records'] if r['project']}
                days = sorted(iso_day(r['turn']['timestamp']) for r in c['records'] if r['turn']['timestamp'])
                roles = [(learn.source_from_turn(db, r['turn'], _ctx(r['prev']), r['project']), 'support') for r in rows]
                stats = {'sessions': len({r['session'] for r in c['records']}), 'projects': sorted(projects), 'corrections': len(c['records']),
                         'first': days[0] if days else None, 'last': days[-1] if days else None, 'terms': c['label']}
                _, new = learn.upsert_candidate(db, 'correction', ' '.join(c['label'][:2]), f'Repeated correction about “{c["term"]}”',
                    f'{stats["corrections"]} human corrections mentioning "{c["term"]}" across {stats["sessions"]} sessions '
                    f'({", ".join(sorted(projects)[:5]) or "unattributed"}). Shared terms: {", ".join(c["label"])}.',
                    stats, base_priority('correction', stats['sessions'], len(projects), stats['last']), roles)
                created['correction'] += new
            # ---- repeated requests (Vibecheck's grouping, reused)
            for finding in history._candidate_findings(sorted(human_rows, key=lambda r: r['timestamp'], reverse=True)[:5000]):
                ids = [x.removeprefix('turn_') for x in finding['citations']]
                rows = [r for r in human_rows if r['id'] in set(ids)][:6]
                exceptions = {x.removeprefix('turn_') for x in finding['exceptions']}
                roles = [(learn.source_from_turn(db, r, [], None), 'support') for r in rows]
                roles += [(learn.source_from_turn(db, r, [], None), 'contrary') for r in human_rows if r['id'] in exceptions][:3]
                projects = {project_of(r['cwd']) for r in rows if project_of(r['cwd'])}
                days = sorted(iso_day(r['timestamp']) for r in rows)
                stats = {'sessions': len({r['session_id'] for r in rows}), 'projects': sorted(projects), 'first': days[0], 'last': days[-1]}
                _, new = learn.upsert_candidate(db, 'procedure', finding['id'], 'Repeated request that may be a procedure',
                    finding['observation'] + ' ' + finding['uncertainty'], stats,
                    base_priority('procedure', stats['sessions'], len(projects), stats['last'], bool(exceptions)), roles)
                created['procedure'] += new
            # ---- decisions from Choices episodes (human answers to agent questions)
            for c in _episode_clusters(choices_db, limit_per_kind, background, totals['human_turns']):
                roles = [(learn.source_from_episode(db, e), 'support') for e in c['episodes'][:6]]
                projects = {project_of(e.get('project')) for e in c['episodes'] if project_of(e.get('project'))}
                days = sorted(e['date'] for e in c['episodes'] if e.get('date'))
                stats = {'sessions': len({e.get('session') for e in c['episodes']}), 'projects': sorted(projects),
                         'episodes': len(c['episodes']), 'first': days[0] if days else None, 'last': days[-1] if days else None, 'terms': c['label']}
                _, new = learn.upsert_candidate(db, 'decision', ' '.join(c['label'][:2]), f'Repeated decision about “{c["term"]}”',
                    f'{stats["episodes"]} human answers to agent questions mention "{c["term"]}" across {stats["sessions"]} sessions. '
                    'Answers may disagree; adjacent replies are candidate links, not proof of the selected option.',
                    stats, base_priority('decision', stats['sessions'], len(projects), stats['last']), roles)
                created['decision'] += new
            # ---- conflicting copies of the same procedure documents, one candidate per directory pair
            docs = db.execute("SELECT * FROM docs WHERE current=1 AND kind='playbook' ORDER BY path, line_start").fetchall()
            by_name = defaultdict(lambda: defaultdict(list))
            for d in docs:
                by_name[Path(d['path']).name][d['path']].append(d)
            pairs = defaultdict(list)
            for name, files in sorted(by_name.items()):
                if len(files) < 2 or len({secs[0]['file_sha256'] for secs in files.values()}) < 2:
                    continue
                paths = sorted(files)
                a, b = files[paths[0]], files[paths[1]]
                texts_b = {s['heading']: s for s in b}
                differing = [(x, texts_b[x['heading']]) for x in a if x['heading'] in texts_b and x['text'] != texts_b[x['heading']]['text']]
                only = [x for x in a if x['heading'] not in texts_b] + [x for x in b if x['heading'] not in {y['heading'] for y in a}]
                pairs[(str(Path(paths[0]).parent), str(Path(paths[1]).parent))].append(
                    {'name': name, 'a': a, 'b': b, 'differing': differing, 'only': only,
                     'size': sum(abs(len(x['text']) - len(y['text'])) + 1 for x, y in differing) + sum(len(x['text']) for x in only)})
            for (dir_a, dir_b), files in pairs.items():
                files.sort(key=lambda f: -f['size'])
                roles = []
                for f in files[:3]:
                    if f['differing']:
                        x, y = max(f['differing'], key=lambda d: abs(len(d[0]['text']) - len(d[1]['text'])))
                        roles += [(learn.source_from_doc(db, x), 'support'), (learn.source_from_doc(db, y), 'contrary')]
                    else:
                        roles += [(learn.source_from_doc(db, f['a'][0]), 'support'), (learn.source_from_doc(db, f['b'][0]), 'contrary')]
                mtimes = sorted(filter(None, [x['modified'] for f in files for x in (f['a'][0], f['b'][0])]))
                stats = {'directories': [dir_a, dir_b], 'files': [f['name'] for f in files], 'sessions': 0,
                         'differing_sections': sum(len(f['differing']) for f in files), 'unmatched_sections': sum(len(f['only']) for f in files),
                         'projects': sorted({project_of(dir_a + '/') or Path(dir_a).parent.name, project_of(dir_b + '/') or Path(dir_b).parent.name}),
                         'last': iso_day(mtimes[-1]) if mtimes else None}
                _, new = learn.upsert_candidate(db, 'conflict', dir_a + '|' + dir_b, f'{len(files)} procedure documents exist in two diverging copies',
                    f'{dir_a} and {dir_b} both hold {", ".join(f["name"] for f in files)}. The copies differ in {stats["differing_sections"]} '
                    f'same-titled sections and {stats["unmatched_sections"]} sections exist in only one copy. Which copy is canonical is a human decision.',
                    stats, base_priority('conflict', 2, 2, stats['last']) * (1 + math.log2(len(files))), roles)
                created['conflict'] += new
            learn.event(db, 'extract', {'totals': dict(totals), 'created': dict(created)})
        return {'scanned': dict(totals), 'new_candidates': dict(created), 'candidates': learn.status()['candidates'],
                'method': 'deterministic lexical signals over selected local history; observations only', 'network_calls': 0}
    finally:
        conn.close()


def _minutes(start, end):
    try:
        a = datetime.fromisoformat(start.replace('Z', '+00:00'))
        b = datetime.fromisoformat(end.replace('Z', '+00:00'))
    except (AttributeError, ValueError):
        return 0.0
    return max(0.0, (b - a).total_seconds() / 60)


def _ctx(prev):
    if not prev:
        return []
    return [{'role': prev['role'], 'text': prev['text'][:1500], 'line': prev['source_line'], 'date': prev['timestamp']}]


def _doc_context(learn, db, name, cache):
    if name not in cache:
        query = ' '.join('"' + t + '"' for t in re.findall(r'[A-Za-z0-9]{3,}', name)[:4])
        try:
            rows = db.execute('''SELECT d.* FROM docs_fts JOIN docs d ON d.rowid=docs_fts.rowid WHERE docs_fts MATCH ? AND d.current=1
                ORDER BY bm25(docs_fts) LIMIT 2''', (query,)).fetchall() if query else []
        except sqlite3.OperationalError:
            rows = []
        cache[name] = [(learn.source_from_doc(db, r), 'context') for r in rows]
    return cache[name]


def _episode_clusters(path, limit, background=None, background_total=0):
    if not path or not Path(path).is_file():
        return []
    conn = sqlite3.connect(f'file:{Path(path).resolve()}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("""SELECT d.payload FROM decision_episodes d JOIN evidence e ON e.id=d.evidence_id
            WHERE e.status='active'""").fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()
    episodes = []
    for r in rows:
        e = json.loads(r['payload'])
        if len(e.get('answer', '')) < 12 or len(e.get('answer', '')) > 2000:
            continue
        episodes.append({'id': e['id'], 'session': e.get('session'), 'project': project_of(e.get('project')),
                         'terms': _terms(e['question'][:800]) & _terms(e['answer'][:1200]) or _terms(e['answer'][:600]), 'episode': e})
    result = []
    for c in clusters(episodes, limit=limit, background=background, background_total=background_total):
        result.append({'term': c['term'], 'label': c['label'], 'episodes': sorted((r['episode'] for r in c['records']),
                       key=lambda e: e.get('date') or '', reverse=True)})
    return result
