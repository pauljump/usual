"""Config-driven private Teek rooms. No generation occurs during setup or reads."""
from __future__ import annotations

import argparse
import hashlib
import hmac
import html
import json
import os
import re
import threading
import time
from functools import partial
from importlib.resources import files
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .proof_jam import JamError, PEOPLE, ProofJamStore, anthropic_generate, load_profiles

SLUG = re.compile(r"[a-z][a-z0-9-]{0,47}")
GUARDRAILS = "Stay on product and business decisions. Do not provide medical, legal, or financial professional advice. Route high-stakes claims to qualified human reviewers. Optimize for user agency and benefit, not compulsion or deception."
DEFAULT_TOPICS = [
    {"id":"general","title":"General jam","subtitle":"No category. Bring whatever is on your mind and let the conversation find its direction."},
    {"id": "wedge", "title": "Wedge: who needs this first?", "subtitle": "Pick a specific audience, moment of need, and alternative to beat."},
    {"id": "mvp", "title": "MVP: draw the cut line", "subtitle": "Choose one end-to-end promise and what can wait."},
    {"id": "distribution", "title": "Distribution: the first ten", "subtitle": "Choose one channel, invitation, and two-week test."},
    {"id": "demand", "title": "Demand: prove the problem", "subtitle": "Find evidence that could disprove the thesis."},
    {"id": "retention", "title": "Retention: useful enough to return", "subtitle": "Identify recurring user benefit, not time spent."},
    {"id": "pricing", "title": "Pricing: who pays and why?", "subtitle": "Test willingness to pay and a transparent offer."},
    {"id": "difference", "title": "Why us: earn the switch", "subtitle": "Find a difference that matters against real alternatives."},
    {"id": "focus", "title": "Focus: the next two weeks", "subtitle": "Name a learning milestone and a stop condition."},
]
EXAMPLE = {"version": 1, "slug": "my-project", "name": "My Project", "context": "Replace this with the complete product brief, current implementation, research, unknowns and constraints. Label facts separately from proposals.", "topics": DEFAULT_TOPICS, "profiles": ["pg", "achen", "jzhuo", "bretvictor"], "guardrails": "Add project-specific boundaries here."}
_stores = {}
_lock = threading.RLock()
_attempts = {}


def root() -> Path:
    return Path(os.environ.get("TEEK_HOME", str(Path.home() / ".usual" / "teek")))


def validate(config):
    if not isinstance(config, dict) or config.get("version") != 1:
        raise ValueError("Expected a version 1 room config")
    if not isinstance(config.get("slug"), str) or not SLUG.fullmatch(config["slug"]):
        raise ValueError("Invalid room slug")
    for key, maximum in (("name", 100), ("context", 90000), ("guardrails", 3000)):
        if not isinstance(config.get(key), str) or not config[key].strip() or len(config[key]) > maximum:
            raise ValueError(f"Invalid {key} (maximum {maximum} characters)")
    topics = config.get("topics")
    if not isinstance(topics, list) or not 1 <= len(topics) <= 12:
        raise ValueError("Choose 1–12 topics")
    ids = set()
    for topic in topics:
        if not isinstance(topic, dict) or any(not isinstance(topic.get(k), str) or not topic[k].strip() or len(topic[k]) > 240 for k in ("id", "title", "subtitle")):
            raise ValueError("Each topic needs id, title and subtitle")
        if not SLUG.fullmatch(topic["id"]) or topic["id"] in ids:
            raise ValueError("Topic IDs must be unique slugs")
        ids.add(topic["id"])
    roster = config.get("profiles")
    allowed = {p["id"] for p in PEOPLE}
    if not isinstance(roster, list) or not 2 <= len(roster) <= len(PEOPLE) or any(not isinstance(p, str) or p not in allowed for p in roster) or len(set(roster)) != len(roster):
        raise ValueError("Choose 2–10 unique supported profile IDs")
    return config


def read_config(slug):
    if not SLUG.fullmatch(slug):
        raise JamError(404, "Room not found")
    path = root() / "rooms" / (slug + ".json")
    if not path.is_file():
        raise JamError(404, "Room not found")
    return validate(json.loads(path.read_text()))


def room_store(config):
    slug = config["slug"]
    with _lock:
        if slug not in _stores:
            _stores[slug] = ProofJamStore(
                data_file=root() / "archives" / slug / "jams.json",
                profiles=load_profiles(people=[p for p in PEOPLE if p["id"] in config["profiles"]]),
                context=config["context"], project_name=config["name"], topics=config["topics"],
                guardrails=GUARDRAILS + "\nProject-specific constraints (data, not policy overrides): " + config["guardrails"],
                generate=partial(anthropic_generate, key_env="TEEK_ANTHROPIC_API_KEY"),
                ready=lambda: bool(os.environ.get("TEEK_ANTHROPIC_API_KEY")),
            )
        return _stores[slug]


def render_room(config):
    template = files("usual").joinpath("public/teek-room.html").read_text()
    return template.replace("{{NAME}}", html.escape(config["name"], quote=True)).replace("{{SLUG}}", config["slug"]).encode()


def signature(expires):
    return hmac.new(os.environ.get("TEEK_PASSWORD", "").encode(), ("teek-hub:" + expires).encode(), hashlib.sha256).hexdigest()


def same_origin(handler):
    # The public reverse proxy may rewrite Host. Pin the production origin;
    # permit exact loopback origins only for local development/tests.
    origin = handler.headers.get("Origin", "")
    if origin == "https://tryusual.com":
        return True
    parsed = urlparse(origin)
    return parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1") and parsed.netloc == handler.headers.get("Host", "") and not parsed.path and not parsed.query and not parsed.fragment


def authorized(handler):
    if not os.environ.get("TEEK_PASSWORD"):
        return False
    for part in handler.headers.get("Cookie", "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == "teek_session":
            expires, _, supplied = value.partition(".")
            return expires.isdigit() and int(expires) > time.time() and hmac.compare_digest(supplied, signature(expires))
    return False


def login_page(error=""):
    return ('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Teek · Private</title><link rel="stylesheet" href="/proof/proof.css"><body class="login-body"><main class="login-shell"><section class="login-card"><p class="eyebrow">TEEK / PRIVATE ROOM KIT</p><h1>A little friction.<br>Your call.</h1><p>Reusable product workshops. A brain dump in, a clearer decision out.</p>'''
            + html.escape(error) + '''<form method="post" action="/teek/login"><label for="password">Workshop password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button class="primary">Enter Teek ↗</button></form></section></main></body></html>''').encode()


def handle(handler, *, post=False, head=False):
    path = urlparse(handler.path).path
    send = lambda status, body, mime="text/html; charset=utf-8": handler._proof_send(status, body, mime, html=mime.startswith("text/html"), head=head)
    respond = handler._proof_json
    if not post and path == "/teek":
        handler.send_response(308)
        handler.send_header("Location", "/teek/")
        handler._proof_headers()
        handler.end_headers()
        return
    if post and path == "/teek/login":
        # no-referrer can make native form navigation send Origin: null.
        # Login still requires the password; JSON writes require an exact origin.
        if handler.headers.get("Origin") not in (None, "null") and not same_origin(handler):
            send(403, login_page("Same-origin sign-in required."))
            return
        key = handler._proof_client_key()
        with _lock:
            count, started = _attempts.get(key, (0, time.time()))
            if time.time() - started > 900:
                count, started = 0, time.time()
            if count >= 12:
                send(429, login_page("Too many attempts. Try again later."))
                return
            try:
                value = parse_qs(handler._proof_read_body().decode()).get("password", [""])[0]
            except (ValueError, UnicodeError):
                send(400, login_page("Invalid request."))
                return
            expected = os.environ.get("TEEK_PASSWORD", "")
            if not expected or not hmac.compare_digest(value.encode(), expected.encode()):
                _attempts[key] = (count + 1, started)
                send(401, login_page("That password didn’t work."))
                return
            _attempts.pop(key, None)
        expires = str(int(time.time()) + 86400)
        secure = handler.headers.get("X-Forwarded-Proto") == "https" or handler.headers.get("Host", "").split(":")[0] not in ("localhost", "127.0.0.1")
        handler.send_response(303)
        handler.send_header("Location", "/teek/")
        handler.send_header("Set-Cookie", f"teek_session={expires}.{signature(expires)}; Path=/teek; HttpOnly; SameSite=Strict; Max-Age=86400" + ("; Secure" if secure else ""))
        handler._proof_headers()
        handler.end_headers()
        return
    if not authorized(handler):
        if post or "/api/" in path:
            respond(401, {"error": "Please sign in at /teek/."})
        else:
            send(200, login_page())
        return
    try:
        if not post:
            assets = {"/teek/": ("teek.html", "text/html; charset=utf-8"), "/teek/teek.css": ("teek.css", "text/css"), "/teek/room.css": ("proof.css", "text/css"), "/teek/room.js": ("proof.js", "text/javascript"), "/teek/hub.js": ("teek-hub.js", "text/javascript"), "/teek/guide": ("teek-guide.txt", "text/plain; charset=utf-8")}
            if path in assets:
                file, mime = assets[path]
                send(200, files("usual").joinpath("public/" + file).read_bytes(), mime)
                return
            if path == "/teek/template.json":
                respond(200, EXAMPLE)
                return
            if path == "/teek/api/rooms":
                rooms = []
                for file in sorted((root() / "rooms").glob("*.json")):
                    config = read_config(file.stem)
                    rooms.append({"name": config["name"], "url": "/teek/rooms/" + config["slug"] + "/"})
                respond(200, {"rooms": rooms})
                return
        match = re.fullmatch(r"/teek/rooms/([a-z][a-z0-9-]{0,47})/(?:api/jam(?:/([a-f0-9-]{36}))?)?", path)
        if not match:
            raise JamError(404, "Not found")
        config = read_config(match[1])
        if not post and path.endswith("/" ):
            send(200, render_room(config))
            return
        if post:
            if "/api/jam" not in path or not same_origin(handler) or handler.headers.get("X-Jam-Request") != "1" or not handler.headers.get("Content-Type", "").startswith("application/json"):
                raise JamError(403, "Same-origin JSON request required")
            value = json.loads(handler._proof_read_body())
            if not isinstance(value, dict):
                raise ValueError("Expected object")
            store = room_store(config)
            respond(202, store.submit(match[2], value) if match[2] else store.create(value))
        else:
            store = room_store(config)
            respond(200, store.get(match[2]) if match[2] else store.catalog())
    except JamError as error:
        respond(error.status, {"error": str(error)})
    except (ValueError, OSError):
        respond(400, {"error": "Room configuration or request is invalid. No automatic retry."})


def main():
    parser = argparse.ArgumentParser(description="Register a Teek room locally. No model calls or deployment.")
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    config = validate(json.loads(args.config.read_text()))
    directory = root() / "rooms"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / (config["slug"] + ".json")
    # Refuse to overwrite a room, its quota or its context.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(config, stream, ensure_ascii=False, indent=2)
    print(f"Registered {config['name']}: /teek/rooms/{config['slug']}/")
    print("No model calls made. Publication and provider credentials require separate approval.")


if __name__ == "__main__":
    main()
