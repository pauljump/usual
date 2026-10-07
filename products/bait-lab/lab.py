#!/usr/bin/env python3
"""Bait Lab: deterministic, loopback-only credential-verification exercises."""
import argparse
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
VERDICTS = {"accepted", "rejected", "unknown"}
TOKEN = "bait_lab_positive"
CONTROL = "bait_lab_invalid"


def cases():
    return json.loads((ROOT / "cases.json").read_text())


def handler_for(items):
    by_id = {c["id"]: c for c in items}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass

        def do_GET(self):
            self.respond()

        def do_POST(self):
            # Exercises need no submitted body; refuse one instead of retaining it.
            if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Length", "0") != "0":
                self.send_error(413, "This lab accepts empty request bodies only")
                self.close_connection = True
                return
            self.respond()

        def respond(self):
            c = by_id.get(urlsplit(self.path).path.removeprefix("/cases/"))
            if c is None:
                self.send_error(404)
                return
            if self.command != c["method"]:
                self.send_error(405)
                return
            r = c["response"]
            positive = self.headers.get("Authorization") == "Bearer " + TOKEN
            if not positive and c.get("negativeResponse"):
                r = c["negativeResponse"]
            body = r["body"].encode()
            self.send_response(r["status"])
            self.send_header("Content-Type", r.get("contentType", "application/json"))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if "location" in r:
                # Both redirect targets are on this loopback server. No external destinations.
                self.send_header("Location", r["location"])
            self.end_headers()
            self.wfile.write(body)

    return Handler


def start_server(items, port=0):
    server = ThreadingHTTPServer(("127.0.0.1", port), handler_for(items))
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def challenge(c, port):
    return {
        "schema": "bait-lab-challenge-v1", "id": c["id"], "synthetic": True,
        "url": f"http://127.0.0.1:{port}/cases/{c['id']}",
        "method": c["method"], "credential": TOKEN, "invalidControl": CONTROL,
        "authorityAllowed": c["authorityAllowed"],
        "protocol": "bait-lab-principal-v1",
        "task": "Decide whether this credential is accepted by the configured lab authority now. Unknown is required when the evidence cannot establish acceptance or rejection.",
        "context": c.get("context", {}),
    }


def grade(items, answers):
    if not isinstance(answers, list):
        raise ValueError("Answers must be a JSON array")
    valid_ids = {c["id"] for c in items}
    by_id = {}
    for a in answers:
        if not isinstance(a, dict) or a.get("id") not in valid_ids:
            raise ValueError("Answer has an unknown case ID")
        if a["id"] in by_id:
            raise ValueError("Duplicate answer: " + a["id"])
        if a.get("verdict") not in VERDICTS:
            raise ValueError("Verdict must be accepted, rejected, or unknown")
        by_id[a["id"]] = a
    results = []
    for c in items:
        actual = by_id.get(c["id"], {}).get("verdict", "missing")
        results.append({"id": c["id"], "expected": c["expected"], "actual": actual,
                        "passed": actual == c["expected"], "reason": c["reason"],
                        "basis": c["basis"]})
    return {"schema": "bait-lab-result-v1", "synthetic": True,
            "passed": sum(r["passed"] for r in results), "total": len(results),
            "falseAcceptance": sum(r["actual"] == "accepted" and r["expected"] != "accepted" for r in results),
            "missedAcceptance": sum(r["expected"] == "accepted" and r["actual"] != "accepted" for r in results),
            "missing": sum(r["actual"] == "missing" for r in results),
            "results": results,
            "limit": "This measures these synthetic cases only. It is not certification, a real-provider test, or a score for any untested third-party tool."}


def run_adapter(items, command):
    server = start_server(items)
    answers, errors = [], []
    try:
        for c in items:
            try:
                p = subprocess.run(command, input=json.dumps(challenge(c, server.server_port)),
                                   text=True, capture_output=True, timeout=10)
                if p.returncode:
                    raise ValueError("Adapter exited " + str(p.returncode))
                if len(p.stdout) > 65536:
                    raise ValueError("Adapter output exceeds 64 KiB")
                a = json.loads(p.stdout)
                if not isinstance(a, dict) or a.get("verdict") not in VERDICTS:
                    raise ValueError("Adapter must return an object with a valid verdict")
                # The runner binds the result to its case, never an adapter-supplied ID.
                answers.append({"id": c["id"], "verdict": a["verdict"]})
            except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
                errors.append({"id": c["id"], "error": str(exc)[:200]})
    finally:
        server.shutdown()
        server.server_close()
    report = grade(items, answers)
    report["adapterErrors"] = errors
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    s = p.add_subparsers(dest="cmd", required=True)
    s.add_parser("demo", help="Compare deliberately naive and reference examples")
    run = s.add_parser("run", help="Run YOUR local adapter; executable follows --")
    run.add_argument("adapter", nargs=argparse.REMAINDER)
    g = s.add_parser("grade", help="Grade saved JSON answers; nonzero on failure")
    g.add_argument("answers", type=Path)
    serve = s.add_parser("serve", help="Expose synthetic fixtures on loopback only")
    serve.add_argument("--port", type=int, default=8769)
    args = p.parse_args()
    items = cases()
    if args.cmd == "serve":
        server = start_server(items, args.port)
        print(json.dumps([challenge(c, server.server_port) for c in items], indent=2), flush=True)
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            server.shutdown()
            server.server_close()
        return 0
    if args.cmd == "demo":
        reports = {mode: run_adapter(items, [sys.executable, str(ROOT / "examples/validator.py"), mode])
                   for mode in ("naive", "reference")}
        print(json.dumps(reports, indent=2))
        return 0 if reports["reference"]["passed"] == len(items) else 1
    if args.cmd == "run":
        command = args.adapter[1:] if args.adapter[:1] == ["--"] else args.adapter
        if not command:
            p.error("Supply an adapter executable after --")
        report = run_adapter(items, command)
    else:
        report = grade(items, json.loads(args.answers.read_text()))
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] == report["total"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(2)
