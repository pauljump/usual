"""Telegraph Mini: key words in, what Paul meant out.

Runs on the Mini, reachable only over Tailscale (and localhost). The Telegraph keyboard
and app send a few key words; this service

  1. finds Paul's own past words (sent messages, Claude Code and Codex prompts) and the agents' memory
     notes that match their meaning (local embeddings, no network),
  2. asks Claude Haiku for a few short readings of what he means,
  3. asks Jev (TypeSafe) which reading he meant and whether each fits his own words,
  4. on request, has Haiku write the chosen reading out at the asked size, then has Jev
     drop any line that drifts onto a different topic.

POST /readings {"keys", "before"?}            -> readings, Jev scores, sure, choice
POST /write    {"keys", "reading", "size"}    -> text   (size: line | paragraph | brief)
POST /rephrase {"text"}                       -> rewrite in his voice, Jev-checked for same meaning
POST /initials {"pattern", "before"?}         -> experimental first-letter guesses (did not work in tests)
GET  /health

Keys come from the environment (ANTHROPIC_API_KEY, TYPESAFE_API_KEY), supplied by the
fleet vault runner. Haiku calls are capped per day.
"""

import argparse
import datetime
import hashlib
import json
import os
import random
import re
import threading
import time
import urllib.request
import sys
# The fleet invokes Python -I; resolve only this owned module directory.
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from finish import PersonalContext, payload as finish_payload, safe_repair
from corpus import sent_messages, select_context
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import anthropic
import numpy as np
from fastembed import TextEmbedding

HOME = Path.home()
MEMORY = HOME / ".claude/projects/-Users-mini-home-projects/memory"
STATE = HOME / "Library/Application Support/telegraph-mini"
HAIKU = "claude-haiku-5-5"
JEV_URL = "https://api.typesafe.ai/v1/systemone"
DAILY_CAP = int(os.environ.get("TELEGRAPH_DAILY_CAP", "300"))

SIZES = {
    "line": ("one or two sentences, the way he would say it in a post or text", 120),
    "paragraph": ("one paragraph of about 120 words", 400),
    "brief": ("a build brief for a coding agent of at least 1000 words with headings: what to build, why, how "
              "it works step by step, what done looks like, constraints, open questions", 3200),
}

GLOSSARY = ("Jev is TypeSafe AI's fast judgment model: it picks and checks, it never writes text. "
            "In dictated notes 'Jeff' means Jev and 'high-q' or 'haiku' means Claude Haiku.")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# Paul's words ---------------------------------------------------------------------------

def human(t):
    t = t.strip()
    return bool(t) and not t.startswith(("<", "[Request interrupted", "Caveat:", "# AGENTS.md"))


def prose(t):
    t = t.strip()
    if not 40 <= len(t) <= 1500 or any(b in t for b in ("```", "/Users/", "~/", "=>", "{\"", "</")):
        return False
    return sum(c.isalpha() for c in t) / len(t) > 0.6


def claude_turns(path):
    for line in open(path, errors="ignore"):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if o.get("type") != "user" or o.get("isMeta") or o.get("isSidechain"):
            continue
        c = o.get("message", {}).get("content")
        if isinstance(c, list):
            if any(isinstance(p, dict) and p.get("type") == "tool_result" for p in c):
                continue
            c = " ".join(p.get("text", "") for p in c if isinstance(p, dict) and p.get("type") == "text")
        if isinstance(c, str) and human(c):
            yield c.strip(), (o.get("timestamp") or "")[:10], "claude"


def codex_turns(path):
    seen = set()
    for line in open(path, errors="ignore"):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        p = o.get("payload", {})
        t = None
        if o.get("type") == "event_msg" and p.get("type") == "user_message":
            t = p.get("message")
        elif o.get("type") == "response_item" and p.get("type") == "message" and p.get("role") == "user":
            t = " ".join(x.get("text", "") for x in p.get("content", []) if x.get("type") == "input_text")
        if t and human(t) and t not in seen:
            seen.add(t)
            yield t.strip(), (o.get("timestamp") or "")[:10], "codex"


def gather():
    docs = sent_messages()
    for f in sorted(MEMORY.glob("*.md")):
        if f.name != "MEMORY.md":
            body = re.sub(r"^---.*?---\s*", "", f.read_text(errors="ignore"), flags=re.S)
            docs.append({"kind": "memory note", "where": f.stem, "date": "", "text": body[:1800]})
    files = [(claude_turns, f) for f in (HOME / ".claude/projects").glob("*/*.jsonl")]
    for d in ("sessions", "archived_sessions"):
        files += [(codex_turns, f) for f in (HOME / ".codex" / d).rglob("*.jsonl")]
    seen = {d["text"][:120] for d in docs}
    for reader, f in files:
        try:
            for text, date, src in reader(f):
                if prose(text) and text[:120] not in seen:
                    seen.add(text[:120])
                    docs.append({"kind": "Paul said", "where": f"{src} {date}", "source": src, "date": date, "text": text})
        except OSError:
            continue
    return docs


class Index:
    """Meaning search over Paul's words; embeddings cached per passage so refreshes are cheap."""

    def __init__(self):
        self.model = TextEmbedding("BAAI/bge-small-en-v1.5")
        self.cache_path = STATE / "embeddings.npz"
        self.cache = {}
        if self.cache_path.exists():
            z = np.load(self.cache_path)
            self.cache = dict(zip(z["keys"].tolist(), z["vecs"]))
        self.docs, self.vecs = [], np.zeros((0, 384), dtype=np.float32)
        self.lock = threading.Lock()

    def refresh(self):
        t0 = time.time()
        docs = gather()
        keys = [hashlib.sha1(d["text"][:1000].encode()).hexdigest() for d in docs]
        missing = [i for i, k in enumerate(keys) if k not in self.cache]
        if missing:
            for i, v in zip(missing, self.model.embed([docs[i]["text"][:1000] for i in missing], batch_size=64)):
                self.cache[keys[i]] = v
            np.savez(self.cache_path, keys=np.array(list(self.cache)), vecs=np.array(list(self.cache.values())))
        with self.lock:
            self.docs, self.vecs = docs, np.array([self.cache[k] for k in keys])
        log(f"index: {len(docs)} passages ({len(missing)} new) in {time.time() - t0:.1f} s")

    def search(self, query, k_notes=3, k_said=10):
        q = next(iter(self.model.embed([query])))
        with self.lock:
            docs, vecs = self.docs, self.vecs
        today = datetime.date.today()

        def recency(d):
            if not d["date"]:
                return 0.0
            try:
                days = (today - datetime.date.fromisoformat(d["date"])).days
            except ValueError:
                return 0.0
            return 0.05 * 0.5 ** (max(days, 0) / 21)

        scores = vecs @ q + np.array([recency(d) for d in docs])
        return select_context(docs, scores, k_notes, k_said)


# Models -------------------------------------------------------------------------------

class Budget:
    def __init__(self, cap):
        self.cap, self.day, self.used = cap, None, 0
        self.lock = threading.Lock()

    def take(self, n=1):
        with self.lock:
            today = datetime.date.today()
            if self.day != today:
                self.day, self.used = today, 0
            if self.used + n > self.cap:
                return False
            self.used += n
            return True


claude = None
budget = Budget(DAILY_CAP)
meter = threading.local()


def haiku(system, user, max_tokens):
    if not budget.take():
        raise RuntimeError("daily Haiku cap reached")
    r = claude.messages.create(model=HAIKU, max_tokens=max_tokens, system=system,
                               thinking={"type": "disabled"}, output_config={"effort": "low"},
                               messages=[{"role": "user", "content": user}])
    with (STATE / "usage.jsonl").open("a") as receipt:
        receipt.write(json.dumps({"time": time.time(), "model": HAIKU, "test_run": getattr(meter, "test_run", None),
            "input_tokens": r.usage.input_tokens, "output_tokens": r.usage.output_tokens,
            "usd": (r.usage.input_tokens * .10 + r.usage.output_tokens * .50) / 1e6}) + "\n")
    if r.stop_reason != "end_turn":
        raise RuntimeError("model response incomplete; draft preserved")
    return "".join(b.text for b in r.content if b.type == "text").strip()


def jev(state, questions):
    req = urllib.request.Request(
        JEV_URL, data=json.dumps({"state": state, "model": "jev-latest", "questions": questions}).encode(),
        headers={"Authorization": f"Bearer {os.environ['TYPESAFE_API_KEY']}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=8) as r:
        result = json.load(r)
    with (STATE / "usage.jsonl").open("a") as receipt:
        receipt.write(json.dumps({"time": time.time(), "model": "jev-latest",
            "test_run": getattr(meter, "test_run", None),
            "input_bytes": len(req.data), "usd_input_upper_bound": len(req.data) * .042 / 1e6}) + "\n")
    return result


def context_block(found):
    return "\n\n".join(f"[{i + 1}] ({d['kind']}, {d['where']})\n{d['text']}" for i, d in enumerate(found))


def readings(keys, before, found, n=4):
    system = ("Paul types a few key words instead of explaining an idea. Using his own past words and the notes "
              "below, propose distinct readings of what he means right now. Each reading is one or two plain "
              "sentences in his voice, specific about what he wants said or done. Favor his most recent words. "
              f"Do not invent facts the passages don't support. {GLOSSARY} "
              f"Output exactly {n} lines, one reading per line, no numbering.")
    user = f"Key words: {keys}\n"
    if before.strip():
        user += f"Already written above where he is typing: {before.strip()[-400:]}\n"
    user += f"\nHis past words and notes:\n{context_block(found)}"
    text = haiku(system, user, 600)
    lines = [re.sub(r"^\s*(\d+[.)]|-|\*)\s*", "", l).strip() for l in text.splitlines()]
    return [l for l in lines if len(l) > 15][:n]


def judge(keys, options, found):
    ids = [f"R{i}" for i in range(len(options))]
    order = ids[:]
    random.shuffle(order)  # Jev leans toward the first option
    state = {
        "typed_key_words": keys,
        "readings": {i: options[int(i[1:])] for i in order},
        "pauls_own_words": [d["text"][:500] for d in found if d["kind"] == "Paul said"][:6],
        "notes_about_his_projects": [d["text"][:700] for d in found if d["kind"] == "memory note"][:3],
    }
    questions = {"meant": {"type": "choice",
                           "instructions": "Which entry in `readings` is what Paul meant by `typed_key_words`?",
                           "criteria": {i: None for i in order}}}
    for i in order:
        questions[f"fits_{i}"] = {
            "type": "noul",
            "instructions": f"Is `readings.{i}` consistent with `pauls_own_words` and `notes_about_his_projects`?",
            "criteria": {"true": "Matches what he has said he wants",
                         "false": "Contradicts him, or adds goals he never stated"}}
    a = jev(state, questions)["answers"]
    probs = a["meant"]["probabilities"]
    scored = [{"index": int(i[1:]), "meant": probs.get(i, 0.0), "fits": a[f"fits_{i}"]["noul"],
               "score": probs.get(i, 0.0) * a[f"fits_{i}"]["noul"]} for i in ids]
    scored.sort(key=lambda s: -s["score"])
    top, second = scored[0], (scored[1] if len(scored) > 1 else {"score": 0})
    sure = top["meant"] >= 0.6 and top["fits"] >= 0.6 and top["score"] >= 2 * second["score"]
    return scored, sure


def write(keys, reading, size, found):
    shape, max_tokens = SIZES.get(size, SIZES["paragraph"])
    system = (f"Write what Paul means as {shape}. First person, his voice, plain words, no preamble. "
              "Ground every claim in his past words and notes; never add goals he didn't state. "
              f"Skip passages about other projects. {GLOSSARY}")
    text = haiku(system, f"Key words he typed: {keys}\nWhat he means (confirmed): {reading}\n\n"
                         f"His past words and notes:\n{context_block(found)}", max_tokens)
    if size != "brief":
        return text, 0
    lines = text.splitlines()
    idx = [i for i, l in enumerate(lines) if len(l.split()) >= 6 and not l.lstrip().startswith("#")]
    if not idx:
        return text, 0
    questions = {f"l{n}": {"type": "noul",
                           "instructions": f"Is `lines[{n}]` about the idea in `what_paul_means`?",
                           "criteria": {"true": "Part of that idea: what it is, how it works, why, limits, questions",
                                        "false": "About a different project, product, or topic"}}
                 for n in range(len(idx))}
    a = jev({"what_paul_means": reading, "lines": [lines[i] for i in idx]}, questions)["answers"]
    drop = {idx[n] for n in range(len(idx)) if a[f"l{n}"]["noul"] < 0.3}
    return "\n".join(l for i, l in enumerate(lines) if i not in drop), len(drop)


# First letters ------------------------------------------------------------------------

def initials_of(text):
    """'Sounds good, see you at 7!' -> ['s', 'g', 's', 'y', 'a', '7']; numbers count as one token."""
    return [w if w.isdigit() else w[0] for w in re.findall(r"[a-z0-9']+", text.lower())]


def pattern_tokens(pattern):
    """'sgsya7' or 's g s y a 7' -> ['s','g','s','y','a','7']; a run of digits is one number."""
    return re.findall(r"\d+|[a-z]", pattern.lower())


def from_initials(pattern, before, found, n=6):
    letters = pattern_tokens(pattern)
    if not letters:
        return [], letters
    slots = " ".join(f"{l}=?" for l in letters)
    system = ("Paul typed only the first letter of each word of a message (numbers in full). Fill in the words. "
              f"Give {n} different guesses. Each guess is one line of exactly {len(letters)} slots in the form "
              f"`{slots}`, replacing each ? with one word that starts with that letter (numbers stay as typed). "
              "Make each guess a natural message in his voice about what he has been talking about recently "
              f"(passages below). {GLOSSARY} No other text.")
    user = ""
    if before.strip():
        user += f"Already written above where he is typing: {before.strip()[-400:]}\n\n"
    user += f"His recent words and notes:\n{context_block(found)}"
    text = haiku(system, user, 900)
    out = []
    for line in text.splitlines():
        pairs = re.findall(r"([a-z0-9]+)=([^\s=]+)", line.lower())
        words = [w.strip(".,!?;:") for _, w in pairs]
        if len(words) != len(letters):
            continue
        # The egg sorter in code: every word must start with the letter typed for its slot.
        if all((w == l) if l.isdigit() else w.startswith(l) for w, l in zip(words, letters)):
            sentence = " ".join(words)
            sentence = sentence[0].upper() + sentence[1:]
            if sentence not in out:
                out.append(sentence)
    return out, letters


def judge_initials(pattern, options, before, found):
    ids = [f"S{i}" for i in range(len(options))]
    order = ids[:]
    random.shuffle(order)
    state = {"first_letters_typed": " ".join(pattern_tokens(pattern)),
             "candidates": {i: options[int(i[1:])] for i in order},
             "already_written_above": before.strip()[-400:],
             "pauls_recent_words": [d["text"][:400] for d in found if d["kind"] == "Paul said"][:6]}
    questions = {"meant": {"type": "choice",
                           "instructions": "Which entry in `candidates` is the message Paul most likely meant to type?",
                           "criteria": {i: None for i in order}}}
    a = jev(state, questions)["answers"]["meant"]
    probs = a["probabilities"]
    ranked = sorted(range(len(options)), key=lambda i: -probs.get(f"S{i}", 0))
    top = probs.get(f"S{ranked[0]}", 0)
    second = probs.get(f"S{ranked[1]}", 0) if len(ranked) > 1 else 0
    return [(options[i], probs.get(f"S{i}", 0)) for i in ranked], top >= 0.6 and top >= 2 * second


# Rephrase -----------------------------------------------------------------------------

def rephrase(text, found):
    """Haiku rewrites in Paul's voice; Jev checks it still says only what he said."""
    system = ("Rewrite Paul's draft so it reads clearly and naturally, in his own voice (his past words below "
              "show how he writes). Keep every point and its meaning; add no new claims, facts, or requests; keep "
              f"about the same length. Output only the rewrite. {GLOSSARY}")
    user = f"Draft:\n{text}\n\nHow he writes (his past words):\n{context_block(found)}"
    for attempt in range(2):
        out = haiku(system, user, max(200, len(text) // 2 + 200))
        a = jev({"original": text, "rewrite": out}, {
            "same": {"type": "noul",
                     "instructions": "Does `rewrite` say the same thing as `original`, with nothing added or dropped?",
                     "criteria": {"true": "Same points and meaning, only the wording changed",
                                  "false": "Adds, drops, or changes a point"}}})["answers"]["same"]["noul"]
        if a >= 0.5:
            return out, a
    return out, a


# HTTP ---------------------------------------------------------------------------------

index = None
finish_context = PersonalContext(Path(__file__).resolve().parents[1] / "eval/private/training.json")


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/keyboard-license":
            # Only this optional license is returned; provider credentials never leave the Mini.
            key = ""
            for line in (HOME / ".secrets/telegraph.env").read_text().splitlines():
                if line.startswith("KEYBOARDKIT_LICENSE_KEY="):
                    key = line.split("=", 1)[1].strip().strip("\"'")
            return self.reply(200, {"key": key}) if key else self.reply(404, {"error": "No KeyboardKit Pro license"})
        if self.path == "/health":
            self.reply(200, {"ok": True, "passages": len(index.docs) if index else 0, "expansionReady": index is not None, "haikuToday": budget.used, "cap": budget.cap})
        else:
            self.reply(404, {"error": "not found"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= 65536:
                return self.reply(400, {"error": "request body must be 1–65536 bytes"})
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                return self.reply(400, {"error": "JSON object required"})
            meter.test_run = body.get("test_run") if isinstance(body.get("test_run"), str) else None
            if self.path == "/finish":
                t0 = time.perf_counter()
                text = body.get("text")
                if not isinstance(text, str) or not text.strip() or len(text) > 6000:
                    return self.reply(400, {"error": "draft must contain 1–6000 characters"})
                recent = body.get("recent", [])
                if not isinstance(recent, list) or not all(isinstance(t, str) for t in recent):
                    return self.reply(400, {"error": "recent must be a list of text"})
                system, user = finish_payload(text, finish_context, [t[:1000] for t in recent[-5:]])
                out = haiku(system, user, min(2400, max(600, len(text))))
                out, accepted = safe_repair(text, out)
                ms = round((time.perf_counter() - t0) * 1000)
                log(f"finish {len(text)} chars, accepted={accepted}, {ms} ms")
                return self.reply(200, {"text": out, "accepted": accepted, "ms": ms})
            if index is None:
                return self.reply(503, {"error": "History is warming up. Finish is ready; try Expand shortly."})
            if self.path == "/initials":
                t0 = time.time()
                pattern = (body.get("pattern") or "")[:120]
                before = body.get("before", "")
                found = index.search(before.strip()[-300:] or "what Paul has been working on today", k_notes=2, k_said=8)
                options, letters = from_initials(pattern, before, found)
                t_gen = time.time() - t0
                if not options:
                    return self.reply(200, {"candidates": [], "sure": False, "ms": {"haiku": int(t_gen * 1000)}})
                ranked, sure = judge_initials(pattern, options, before, found) if len(options) > 1 else ([(options[0], 1.0)], True)
                ms = {"haiku": int(t_gen * 1000), "jev": int((time.time() - t0 - t_gen) * 1000)}
                log(f"initials '{' '.join(letters)}' {len(options)} valid, sure={sure} {ms}")
                return self.reply(200, {"candidates": [{"text": t, "p": p} for t, p in ranked], "sure": sure, "ms": ms})
            if self.path == "/rephrase":
                t0 = time.time()
                text = (body.get("text") or "").strip()[:3000]
                if not text:
                    return self.reply(400, {"error": "text required"})
                out, same = rephrase(text, index.search(text[:500], k_notes=0, k_said=6))
                ms = int((time.time() - t0) * 1000)
                log(f"rephrase {len(text)} chars -> {len(out)}, same={same:.2f}, {ms} ms")
                return self.reply(200, {"text": out, "same": same, "ms": ms})
            keys = (body.get("keys") or "").strip()[:300]
            if not keys:
                return self.reply(400, {"error": "keys required"})
            t0 = time.time()
            found = index.search(keys)
            t_find = time.time() - t0
            if self.path == "/readings":
                options = readings(keys, body.get("before", ""), found)
                t_read = time.time() - t0 - t_find
                scored, sure = judge(keys, options, found)
                ms = {"find": int(t_find * 1000), "haiku": int(t_read * 1000),
                      "jev": int((time.time() - t0 - t_find - t_read) * 1000)}
                log(f"readings '{keys}' sure={sure} {ms}")
                return self.reply(200, {"readings": options, "scores": scored, "sure": sure,
                                        "choice": scored[0]["index"] if sure else None, "ms": ms})
            if self.path == "/write":
                reading = (body.get("reading") or "").strip()
                text, dropped = write(keys, reading, body.get("size", "paragraph"), found)
                ms = int((time.time() - t0) * 1000)
                log(f"write '{keys}' size={body.get('size')} {len(text.split())} words, dropped {dropped}, {ms} ms")
                return self.reply(200, {"text": text, "dropped": dropped, "ms": ms})
            return self.reply(404, {"error": "not found"})
        except Exception as e:  # report every failure to the phone instead of hanging it
            log("error", repr(e))
            return self.reply(500, {"error": str(e)[:300]})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bind", action="append", default=[])
    ap.add_argument("--port", type=int, default=8773)
    ap.add_argument("--refresh-hours", type=float, default=3)
    args = ap.parse_args()
    STATE.mkdir(parents=True, exist_ok=True)
    global claude, index
    claude = anthropic.Anthropic(max_retries=2, timeout=60)
    def refresher():
        global index
        while True:
            try:
                next_index = index or Index()
                next_index.refresh()
                index = next_index
            except Exception as e:
                log("refresh failed", repr(e))
            time.sleep(args.refresh_hours * 3600)

    threading.Thread(target=refresher, daemon=True).start()
    for host in args.bind or ["127.0.0.1"]:
        server = ThreadingHTTPServer((host, args.port), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        log(f"listening on {host}:{args.port}")
    threading.Event().wait()


if __name__ == "__main__":
    main()
