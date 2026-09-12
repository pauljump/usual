"""Local tool selection, managed installation and deliberately small public recipes.

This store is independent of decision/history stores. Nothing here calls a provider.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import html
import json
import os
from pathlib import Path
import re
import tempfile
import uuid
from urllib.parse import quote, urlsplit

REPOSITORY = "https://github.com/pauljump/usual"
ROOT = Path(__file__).resolve().parent
CATALOG_PATH = ROOT / "catalog.json"
BEGIN = "<!-- usual:pop:start -->"
END = "<!-- usual:pop:end -->"
BROWSERS = ("chrome", "safari", "both")


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def catalog():
    return json.loads(CATALOG_PATH.read_text())


def item(tool):
    for entry in catalog()["items"]:
        if entry["id"] == tool:
            return entry
    raise ValueError("Unknown catalog item: " + str(tool))


def private_home(home):
    home = Path(home).expanduser().resolve()
    if any((p / ".git").exists() for p in [home, *home.parents]):
        raise ValueError("Private setup and history must live outside source repositories.")
    home.mkdir(parents=True, exist_ok=True, mode=0o700)
    return home


def write_json(path, value):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Refusing to replace a symlink.")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix=".usual-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def reject_symlink_components(path, boundary):
    """Keep managed writes within the selected directory, including parent components."""
    path, boundary = Path(path), Path(boundary)
    if not path.is_relative_to(boundary):
        raise ValueError("Managed target is outside its selected directory.")
    current = path
    while True:
        if current.is_symlink():
            raise ValueError("Refusing a symlink in a managed target or parent directory.")
        if current == boundary:
            break
        current = current.parent


@contextmanager
def setup_lock(home):
    home = private_home(home)
    path = home / "setup.json"
    for owned in (home / "setup.lock", path, home / "receipts"):
        reject_symlink_components(owned, home)
    fd = os.open(home / "setup.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a+") as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        reject_symlink_components(path, home)
        state = json.loads(path.read_text()) if path.exists() else {
            "schema_version": 1, "items": {}, "created_at": now()}
        yield state
        state["updated_at"] = now()
        write_json(path, state)


def inspect_setup(home):
    home = Path(home).expanduser().resolve()
    path = home / "setup.json"
    reject_symlink_components(path, home)
    state = json.loads(path.read_text()) if path.exists() else {"schema_version": 1, "items": {}}
    if "loops" in state["items"] and (home / "loops").exists():
        from .loops import list_routines
        state["items"]["loops"]["routines"] = list_routines(home)
    return {**state, "repository": REPOSITORY,
            "note": "Installed and behavior-verified are separate. Findings and transcripts are separate private objects."}


def receipt(home, tool, action, outcome, checks=None, limitation=None):
    value = {"schema_version": 1, "id": "receipt-" + uuid.uuid4().hex[:16],
             "created_at": now(), "tool": tool, "action": action, "outcome": outcome,
             "checks": checks or [], "limitation": limitation or "No live-agent behavior was verified.",
             "repository": REPOSITORY}
    home = private_home(home)
    path = home / "receipts" / (value["id"] + ".json")
    reject_symlink_components(path, home)
    write_json(path, value)
    return value


def config_for(tool, config):
    schema = item(tool)["configuration"]
    if not isinstance(config, dict) or set(config) - set(schema):
        raise ValueError("Unknown configuration fields for " + tool)
    for key, value in config.items():
        if value not in schema[key]["values"]:
            raise ValueError("Unsupported configuration value for " + key)
    return dict(config)


def scope_path(scope):
    result = Path(scope).expanduser().resolve()
    if not result.is_dir():
        raise ValueError("Scope must be an existing local directory.")
    return str(result)


def pop_rule(browser):
    if browser not in BROWSERS:
        raise ValueError("Choose chrome, safari, or both.")
    example = pop_format("https://example.com", browser)
    return (f"{BEGIN}\n## Usual Pop\n\n"
            f"For an actionable URL use this {browser} link format:\n\n{example}\n\n"
            "Keep the destination host, path, query and fragment unchanged; change only the scheme. "
            "Chrome's iOS scheme is googlechromes:// for HTTPS or googlechrome:// for HTTP. "
            "Safari's candidate iOS scheme is x-safari-https:// for HTTPS; omit Safari for HTTP. "
            "Scheme/device behavior must be checked on the user's client. "
            "Desktop links are ordinary HTTP(S) links and use the default browser. "
            "Do not claim a clickable desktop link forces a browser. "
            "Keep citations and passing references as ordinary links. "
            "Opening a desktop app is a separate explicit action under current permissions; "
            "never change permission settings or automatically open a browser.\n\n"
            f"Source: {REPOSITORY} · Pop {item('pop')['source']['version']}\n{END}")


def pop_format(url, browser="both"):
    if browser not in BROWSERS:
        raise ValueError("Unsupported browser.")
    if not isinstance(url, str) or any(ord(c) < 33 for c in url) or len(url) > 8192:
        raise ValueError("Use a single HTTP(S) URL without whitespace or control characters.")
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Use an HTTP(S) URL without embedded credentials.")
    # Encode Markdown delimiters, preserving URL meaning and existing escapes.
    safe = quote(url, safe=":/?#[]@!$&'*+,;=%~_-")
    tail = safe.split("://", 1)[1]
    links = []
    if browser in ("chrome", "both"):
        scheme = "googlechromes" if parsed.scheme == "https" else "googlechrome"
        links.append(f"[Chrome]({scheme}://{tail})")
    if browser in ("safari", "both") and parsed.scheme == "https":
        links.append(f"[Safari](x-safari-https://{tail})")
    return " · ".join([*links, f"[Desktop]({safe})", f"`{safe}`"])


def managed_block(text):
    if text.count(BEGIN) != text.count(END) or text.count(BEGIN) > 1:
        raise ValueError("Conflicting Pop markers; inspect the instruction file before changing it.")
    if BEGIN not in text:
        return None
    start, finish = text.index(BEGIN), text.index(END) + len(END)
    if finish < start:
        raise ValueError("Malformed Pop block.")
    return text[start:finish]


def target_file(client, client_home, project=None):
    if client not in ("codex", "claude"):
        raise ValueError("Supported instruction clients: codex, claude.")
    base = Path(scope_path(project)) if project else Path(client_home).expanduser().resolve()
    target = base / (("AGENTS.md" if client == "codex" else "CLAUDE.md") if project
                     else (".codex/AGENTS.md" if client == "codex" else ".claude/CLAUDE.md"))
    reject_symlink_components(target, base)
    return target


def replace_file(path, content):
    if path.is_symlink():
        raise ValueError("Refusing to edit a symlinked instruction file.")
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    fd, temp = tempfile.mkstemp(prefix=".usual-pop-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(content)
        os.chmod(temp, mode)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def install_pop(home, client="codex", client_home=None, browser="both", project=None):
    target = target_file(client, client_home or Path.home(), project)
    if target.is_symlink():
        raise ValueError("Refusing to edit a symlinked instruction file.")
    rule = pop_rule(browser)
    with setup_lock(home) as state:
        previous = state["items"].get("pop", {})
        prior_target = previous.get("target")
        if prior_target and prior_target != str(target) and previous.get("enabled"):
            raise ValueError("Pop is active at another target. Disable it first before selecting a new scope.")
        text = target.read_text() if target.exists() else ""
        block = managed_block(text)
        if block:
            if block != rule and digest(block) != previous.get("managed_sha256"):
                raise ValueError("Pop's managed rule was edited. Preserve and reconcile those edits before updating.")
            updated = text.replace(block, rule, 1)
        else:
            if re.search(r"^## Usual Pop\b", text, re.M):
                raise ValueError("An existing unmarked Pop rule needs explicit reconciliation; it was left intact.")
            updated = text + ("\n\n" if text else "") + rule + "\n"
        if updated != text:
            replace_file(target, updated)
        state["items"]["pop"] = {**previous, "id": "pop", "version": item("pop")["source"]["version"],
            "selected": True, "installed": True, "enabled": True,
            "config": {"browser": browser}, "scope": str(target.parent), "client": client,
            "target": str(target), "managed_sha256": digest(rule),
            "target_root": str(Path(project).expanduser().resolve() if project else Path(client_home or Path.home()).expanduser().resolve()),
            "verification": previous.get("verification", {"status": "not-checked"})
                if block == rule else {"status": "not-checked"}, "updated_at": now()}
        state["items"]["pop"].pop("removed_at", None)
    return {"item": inspect_setup(home)["items"]["pop"], "receipt": receipt(home, "pop", "install",
        "Installed managed instruction block; unrelated customization preserved.",
        ["One managed block", "Exact installed content checked"],
        "Installed only. A new live-agent session and physical browser navigation remain unverified.")}


def install_tool(home, tool, scope, config=None, client="codex", client_home=None):
    entry = item(tool)
    scope = scope_path(scope)
    prior = inspect_setup(home)["items"].get(tool, {})
    config = config_for(tool, config if config is not None else prior.get("config", {}))
    if tool == "pop":
        return install_pop(home, client, client_home, config.get("browser", "both"), project=scope)
    with setup_lock(home) as state:
        previous = state["items"].get(tool, {})
        if tool == "escape":
            vendor = ROOT / "vendor/escape_webview"
            artifact = Path(scope) / "escape-webview.js"
            files = [(vendor / "escape-webview.js", artifact),
                     (vendor / "LICENSE", Path(scope) / "escape-webview.LICENSE")]
            # Validate every source and destination before copying either file.
            for source, target in files:
                if not source.is_file():
                    raise ValueError("Pinned Escape asset or MIT license is missing; reinstall the source bundle.")
                reject_symlink_components(target, Path(scope))
                if target.exists() and (not target.is_file() or target.stat().st_size != source.stat().st_size
                                        or target.read_bytes() != source.read_bytes()):
                    raise ValueError(f"Existing {target.name} differs; it was preserved. Choose another scope or reconcile it.")
            for source, target in files:
                if not target.exists():
                    with target.open("xb") as stream:
                        stream.write(source.read_bytes())
            artifact_hash = hashlib.sha256(artifact.read_bytes()).hexdigest()
            outcome = ('Copied the pinned widget and MIT license. Add '
                       '<script src="/escape-webview.js?v=1.0.0-usual.1" defer data-auto data-analytics="off"></script>'
                       ' to the website to enable it. Telemetry remains off. Website behavior is not verified.')
        else:
            artifact = ROOT / ("history.py" if tool in ("recall", "vibecheck") else "loops.py" if tool == "loops" else "cli.py")
            if not artifact.is_file():
                raise ValueError("Runtime module missing; reinstall the source bundle.")
            artifact_hash = hashlib.sha256(artifact.read_bytes()).hexdigest()
            outcome = "Local command ready in this runtime; selection and scope saved."
        same_install = (previous.get("installed") and previous.get("artifact_sha256") == artifact_hash
                        and previous.get("config") == config and previous.get("scope") == scope
                        and previous.get("version") == entry["source"]["version"])
        state["items"][tool] = {**previous, "id": tool, "version": entry["source"]["version"],
            "selected": True, "installed": True, "enabled": True, "config": config,
            "scope": scope, "artifact": str(artifact), "artifact_sha256": artifact_hash,
            "verification": previous.get("verification", {"status": "not-checked"}) if same_install else {"status": "not-checked"},
            "updated_at": now()}
        state["items"][tool].pop("removed_at", None)
    return {"item": inspect_setup(home)["items"][tool],
            "receipt": receipt(home, tool, "install", outcome, ["Runtime/asset exists", "SHA-256 recorded"])}


def configure(home, tool, config=None, scope=None):
    with setup_lock(home) as state:
        selected = state["items"].get(tool)
        if not selected:
            raise ValueError("Select or install this item first.")
        if tool == "pop" and selected.get("enabled"):
            raise ValueError("Use pop install with the new browser to safely update the active managed rule.")
        if config is not None:
            selected["config"] = config_for(tool, config)
        if scope is not None:
            selected["scope"] = scope_path(scope)
        selected["verification"] = {"status": "not-checked"}
        selected["updated_at"] = now()
    return inspect_setup(home)


def disable(home, tool, remove=False):
    item(tool)
    with setup_lock(home) as state:
        selected = state["items"].get(tool)
        if not selected:
            return {"outcome": "Item is already absent."}
        if tool == "pop" and selected.get("enabled") and selected.get("target"):
            target = Path(selected["target"])
            reject_symlink_components(target, Path(selected.get("target_root", target.parent)))
            if target.is_symlink():
                raise ValueError("Refusing to edit a symlinked instruction file.")
            text = target.read_text() if target.exists() else ""
            block = managed_block(text)
            if block:
                if digest(block) != selected.get("managed_sha256"):
                    raise ValueError("Managed Pop block was edited; preserved for explicit reconciliation.")
                replace_file(target, text.replace(block, "", 1))
        if tool == "loops":
            from .loops import list_routines, disable_routine
            for routine in list_routines(Path(home)):
                disable_routine(Path(home), routine["routine"]["id"])
        selected.update(enabled=False, selected=not remove, installed=False if tool == "pop" else selected.get("installed", False))
        selected["updated_at"] = now()
        if remove:
            # Keep a tombstone: removal never deletes evidence, receipts or user files.
            selected["removed_at"] = now()
    outcome = "Removed from My Usual; private evidence and unrelated files preserved." if remove else "Disabled in My Usual."
    if tool == "escape":
        outcome += " Remove the script tag from your website to stop the widget there; its source file was preserved."
    return {"item": inspect_setup(home)["items"][tool], "receipt": receipt(home, tool, "remove" if remove else "disable", outcome)}


def verify_pop(home, url, browser=None):
    state = inspect_setup(home)
    selected = state["items"].get("pop")
    browser = browser or (selected or {}).get("config", {}).get("browser", "both")
    formatted = pop_format(url, browser)
    checks = ["HTTP(S) destination validated", "Scheme mapping preserves destination", "Ordinary desktop and copy links emitted"]
    if selected and selected.get("enabled"):
        target = Path(selected["target"])
        reject_symlink_components(target, Path(selected.get("target_root", target.parent)))
        block = managed_block(target.read_text())
        if not block or digest(block) != selected.get("managed_sha256"):
            raise ValueError("Installed rule differs from the receipt; verification failed.")
        if browser != selected["config"]["browser"]:
            raise ValueError("Verification browser differs from the installed setting.")
        checks.append("Installed managed rule matches")
        with setup_lock(home) as current:
            current["items"]["pop"]["verification"] = {"status": "scripted-format-checked", "at": now(),
                "environment": "Python formatter and managed instruction file", "live_agent": False, "device_navigation": False}
    return {"formatted": formatted, "receipt": receipt(home, "pop", "use", "Link formatted and deterministic checks passed.", checks,
        "Scripted formatter verification; this does not prove a live agent follows the rule or a device opens the browser.")}


def export_recipe(home, include_config=(), reviewed=False):
    if not reviewed:
        raise ValueError("Review the selected public fields, then pass --reviewed to export.")
    allowed = set(include_config)
    if allowed - {"pop.browser"}:
        raise ValueError("Only the explicit safe option pop.browser can be shared in this release.")
    modules = []
    for tool, selected in sorted(inspect_setup(home)["items"].items()):
        if not selected.get("selected") or not selected.get("enabled"):
            continue
        entry = item(tool)
        version = selected.get("version")
        if version != entry["source"]["version"]:
            raise ValueError("Selected item has an unsupported version; inspect and explicitly update before exporting.")
        module = {"id": tool, "version": version}
        if tool == "pop" and "pop.browser" in allowed and "browser" in selected.get("config", {}):
            module["config"] = config_for("pop", {"browser": selected["config"]["browser"]})
        modules.append(module)
    return {"schema_version": 1, "kind": "usual-setup", "repository": REPOSITORY, "modules": modules}


def validate_recipe(recipe):
    if not isinstance(recipe, dict) or set(recipe) != {"schema_version", "kind", "repository", "modules"}:
        raise ValueError("Recipe contains missing or non-public fields.")
    if recipe["schema_version"] != 1 or recipe["kind"] != "usual-setup" or recipe["repository"] != REPOSITORY:
        raise ValueError("Unsupported recipe schema or source.")
    if not isinstance(recipe["modules"], list) or len(recipe["modules"]) > 6:
        raise ValueError("Invalid modules list.")
    seen = set()
    for module in recipe["modules"]:
        if not isinstance(module, dict) or set(module) not in ({"id", "version"}, {"id", "version", "config"}):
            raise ValueError("Recipe module contains private or unknown fields.")
        entry = item(module["id"])
        if module["id"] in seen or module["version"] != entry["source"]["version"]:
            raise ValueError("Duplicate module or unsupported version; inspect and adapt the recipe.")
        config_for(module["id"], module.get("config", {}))
        seen.add(module["id"])
    return recipe


def import_recipe(home, recipe, scope, reviewed=False):
    validate_recipe(recipe)
    if not reviewed:
        return {"review": recipe, "next": "Choose your own scope and pass --reviewed. Import selects items; install is a separate action."}
    scope = scope_path(scope)
    with setup_lock(home) as state:
        # Validate the whole import before changing anything.
        for module in recipe["modules"]:
            prior = state["items"].get(module["id"])
            if prior and (prior.get("config", {}) != module.get("config", {}) or prior.get("scope") != scope):
                raise ValueError("Recipe conflicts with existing setup; inspect and adjust it explicitly.")
        for module in recipe["modules"]:
            state["items"].setdefault(module["id"], {**module, "config": module.get("config", {}),
                "scope": scope, "selected": True, "enabled": True, "installed": False,
                "verification": {"status": "not-checked"}, "updated_at": now()})
    return {"setup": inspect_setup(home), "receipt": receipt(home, "setup", "import", "Recipe inspected and selected. No instructions or routines were executed.")}


def recipe_html(recipe):
    validate_recipe(recipe)
    rows = "".join(f'<li><b>{html.escape(item(m["id"])["name"])}</b><span>{html.escape(m["version"])}</span>'
                   + (f'<small>{html.escape(m["config"]["browser"])} links</small>' if m.get("config") else "") + '</li>'
                   for m in recipe["modules"])
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Usual · setup recipe</title><style>body{background:#f6f1e8;color:#24241f;font:18px system-ui;padding:7vw}main{max-width:620px;margin:auto}h1{font:64px Georgia}li{padding:20px 0;border-bottom:1px dotted #777;list-style:none}li span{float:right;color:#5c6852}small{display:block;margin-top:8px}a{color:#a83c15}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}ul{padding:0}</style><main><p>YOUR AI, HOW YOU LIKE IT.</p><h1>My Usual</h1><p>A reviewed tool selection. Choose your own scope and inspect before installing.</p><ul>' + rows + f'</ul><p><a href="{REPOSITORY}">Inspect Usual on GitHub</a></p><p>No history, source quotes, local paths, permissions, private routines or unreviewed preferences are included.</p><details><summary>Inspect recipe JSON</summary><pre>{html.escape(json.dumps(recipe, indent=2))}</pre></details></main></html>'


def setup_html(home):
    setup = inspect_setup(home)
    rows = []
    for tool, value in setup["items"].items():
        rows.append(f'<section><h2>{html.escape(item(tool)["name"])}</h2><p>{"Enabled" if value.get("enabled") else "Disabled"} · {"Installed" if value.get("installed") else "Not installed"} · {html.escape(value.get("verification", {}).get("status", "not-checked"))}</p><pre>{html.escape(json.dumps(value, indent=2))}</pre></section>')
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Usual · private inspection</title><style>body{background:#f6f1e8;color:#24241f;font:17px system-ui;max-width:850px;margin:6vw auto;padding:24px}h1{font:54px Georgia}section{border-top:1px dotted #777}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}</style><h1>My Usual</h1><p>Private local inspection. Keep this file private. Edit with setup configure; disable or remove with setup disable/remove. Share only through setup export.</p>' + (''.join(rows) or '<p>No tools selected yet. Browse the menu or install Pop independently.</p>') + f'<p><a href="{REPOSITORY}">Usual source</a></p></html>'
