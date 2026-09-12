"""Collection commands, dispatched before the unchanged Choices command parser."""
import argparse
import json
import os
from pathlib import Path
import sys


COMMANDS = {"menu", "setup", "pop", "recall", "vibecheck", "loops"}


def dispatch(argv):
    argv = list(sys.argv[1:] if argv is None else argv)
    home = Path.home() / ".usual"
    if argv[:1] == ["--home"]:
        if len(argv) < 3:
            raise ValueError("Use --home PRIVATE_DIRECTORY before a collection command.")
        home, argv = Path(argv[1]).expanduser(), argv[2:]
    if not argv or argv[0] not in COMMANDS:
        return None
    if os.name != "posix":
        raise ValueError("The six-item local collection currently requires macOS or Linux (POSIX). Legacy Choices commands remain available.")
    from . import collection as c
    command, tail = argv[0], argv[1:]
    if command in ("recall", "vibecheck"):
        from . import history
        return getattr(history, command + "_main")(tail, home)
    if command == "loops":
        from . import loops
        return loops.main(tail, home)
    parser = argparse.ArgumentParser(prog="usual " + command)
    if command == "menu":
        parser.add_argument("id", nargs="?")
        args = parser.parse_args(tail)
        result = c.item(args.id) if args.id else c.catalog()
    elif command == "pop":
        sub = parser.add_subparsers(dest="action", required=True)
        install = sub.add_parser("install")
        install.add_argument("--client", choices=["codex", "claude"], required=True)
        install.add_argument("--client-home", type=Path, default=Path.home())
        install.add_argument("--project", type=Path)
        install.add_argument("--browser", choices=c.BROWSERS, default="both")
        for name in ("use", "verify"):
            use = sub.add_parser(name)
            use.add_argument("url")
            use.add_argument("--browser", choices=c.BROWSERS)
        sub.add_parser("disable")
        sub.add_parser("remove")
        args = parser.parse_args(tail)
        if args.action == "install":
            result = c.install_pop(home, args.client, args.client_home, args.browser, args.project)
        elif args.action in ("use", "verify"):
            selected = c.inspect_setup(home)["items"].get("pop", {})
            if selected and not selected.get("enabled") and not args.browser:
                raise ValueError("Pop is disabled. Reinstall or explicitly choose --browser for one independent use.")
            result = c.verify_pop(home, args.url, args.browser)
        else:
            result = c.disable(home, "pop", args.action == "remove")
    else:
        sub = parser.add_subparsers(dest="action", required=True)
        inspect = sub.add_parser("inspect")
        inspect.add_argument("--format", choices=["json", "html"], default="json")
        inspect.add_argument("--out", type=Path)
        for action in ("install", "configure"):
            p = sub.add_parser(action)
            p.add_argument("id")
            p.add_argument("--scope", type=Path, required=action == "install")
            p.add_argument("--config", help='JSON object, for example {"browser":"chrome"}')
            if action == "install":
                p.add_argument("--client", choices=["codex", "claude"], default="codex")
                p.add_argument("--client-home", type=Path, default=Path.home())
        for action in ("disable", "remove"):
            sub.add_parser(action).add_argument("id")
        export = sub.add_parser("export")
        export.add_argument("--out", type=Path)
        export.add_argument("--html", type=Path)
        export.add_argument("--include-config", action="append", default=[])
        export.add_argument("--reviewed", action="store_true")
        imp = sub.add_parser("import")
        imp.add_argument("file", type=Path)
        imp.add_argument("--scope", type=Path, default=Path.cwd())
        imp.add_argument("--reviewed", action="store_true")
        receipts = sub.add_parser("receipts")
        receipts.add_argument("--limit", type=int, default=10)
        args = parser.parse_args(tail)
        if args.action == "inspect":
            result = c.inspect_setup(home)
            if args.format == "html":
                result = c.setup_html(home)
            if args.out:
                destination = args.out.expanduser().resolve()
                if any((p / ".git").exists() for p in [destination.parent, *destination.parents]):
                    raise ValueError("Private setup inspection must stay outside source repositories; use setup export for a shareable recipe.")
                exclusive_write(args.out, result if isinstance(result, str) else json.dumps(result, indent=2))
                result = {"written": str(args.out), "privacy": "Private inspection; use setup export to share."}
        elif args.action == "install":
            result = c.install_tool(home, args.id, args.scope,
                json.loads(args.config) if args.config else None, args.client, args.client_home)
        elif args.action == "configure":
            result = c.configure(home, args.id, json.loads(args.config) if args.config else None, args.scope)
        elif args.action in ("disable", "remove"):
            result = c.disable(home, args.id, args.action == "remove")
        elif args.action == "export":
            result = c.export_recipe(home, args.include_config, args.reviewed)
            # Preflight every output so an existing file causes no partial overwrite.
            paths = [p for p in (args.out, args.html) if p]
            if len({str(p.resolve()) for p in paths}) != len(paths) or any(p.exists() or p.is_symlink() for p in paths):
                raise ValueError("Choose distinct new export paths; existing files are preserved.")
            if args.out:
                exclusive_write(args.out, json.dumps(result, indent=2) + "\n")
            if args.html:
                exclusive_write(args.html, c.recipe_html(result))
        elif args.action == "import":
            if args.file.stat().st_size > 32768:
                raise ValueError("Recipe exceeds the small setup format's size limit.")
            result = c.import_recipe(home, json.loads(args.file.read_text()), args.scope, args.reviewed)
        elif args.action == "receipts":
            if not 1 <= args.limit <= 100:
                raise ValueError("Choose 1–100 receipts.")
            home = home.resolve()
            c.reject_symlink_components(home / "receipts", home)
            paths = sorted((home / "receipts").glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
            for path in paths[:args.limit]:
                c.reject_symlink_components(path, home)
            result = {"receipts": [json.loads(p.read_text()) for p in paths[:args.limit]]}
    print(result if isinstance(result, str) else json.dumps(result, indent=2))
    return 0


def exclusive_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as stream:
        stream.write(content)
    path.chmod(0o600)
