import copy
import http.client
import json
import os
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode

from usual import teek
from usual.server import PublicAutopilotHandler, ThreadingHTTPServer
from usual.turrii_jam import TurriiJamStore


class TeekTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.env = patch.dict(os.environ, {"TEEK_PASSWORD": "synthetic-hub-password", "TEEK_HOME": cls.directory.name, "TEEK_ANTHROPIC_API_KEY": ""})
        cls.env.start()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), PublicAutopilotHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.env.stop()
        cls.directory.cleanup()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        conn.request(method, path, body, headers or {})
        response = conn.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        conn.close()
        return result

    def login(self):
        status, headers, _ = self.request("POST", "/teek/login", urlencode({"password": "synthetic-hub-password"}), {"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(status, 303)
        self.assertIn("Path=/teek; HttpOnly; SameSite=Strict", headers["Set-Cookie"])
        return headers["Set-Cookie"].split(";", 1)[0]

    def test_gate_routes_and_download(self):
        self.assertEqual(self.request("GET", "/teek")[0], 308)
        status, headers, body = self.request("GET", "/teek/")
        self.assertIn(b"Workshop password", body)
        self.assertIn("noindex", headers["X-Robots-Tag"])
        self.assertIn("no-store", headers["Cache-Control"])
        self.assertEqual(self.request("GET", "/teek/api/rooms")[0], 401)
        self.assertEqual(self.request("POST", "/teek/login", "password=wrong")[0], 401)
        cookie = self.login()
        status, _, body = self.request("GET", "/teek/", headers={"Cookie": cookie})
        self.assertEqual(status, 200)
        self.assertIn(b"A room for", body)
        self.assertNotIn(b"synthetic-hub-password", body)
        for path in ("/teek/hub.js", "/teek/teek.css", "/teek/room.js", "/teek/room.css", "/teek/guide"):
            self.assertEqual(self.request("GET", path, headers={"Cookie": cookie})[0], 200)
        result = self.request("GET", "/teek/template.json", headers={"Cookie": cookie})
        self.assertEqual(teek.validate(json.loads(result[2]))["version"], 1)
        # A hub cookie must not open the existing Turrii workshop.
        self.assertEqual(self.request("GET", "/turrii/api/jam", headers={"Cookie": cookie})[0], 401)

    def test_login_accepts_native_no_referrer_form_but_rejects_foreign_origin(self):
        body = urlencode({"password": "synthetic-hub-password"})
        self.assertEqual(self.request("POST", "/teek/login", body, {"Origin": "null", "Content-Type": "application/x-www-form-urlencoded"})[0], 303)
        self.assertEqual(self.request("POST", "/teek/login", body, {"Origin": "https://evil.example", "Content-Type": "application/x-www-form-urlencoded"})[0], 403)
        class Request:
            headers = {"Origin": "null", "Host": "tryusual.com"}
        self.assertFalse(teek.same_origin(Request()))

    def test_config_validation_and_escaped_room(self):
        for field, value in (("slug", "../escape"), ("profiles", ["pg", "../../secret"]), ("context", "")):
            config = copy.deepcopy(teek.EXAMPLE)
            config[field] = value
            with self.assertRaises(ValueError):
                teek.validate(config)
        config = copy.deepcopy(teek.EXAMPLE)
        config["name"] = '<script>alert("x")</script>'
        result = teek.render_room(teek.validate(config))
        self.assertNotIn(b'<script>alert', result)
        self.assertIn(b'&lt;script&gt;', result)
        self.assertIn(b'Your brain dump', result)

    def test_registration_refuses_overwrite_and_room_api_is_guarded(self):
        config = copy.deepcopy(teek.EXAMPLE)
        config["slug"] = "fixture"
        source = Path(self.directory.name) / "input.json"
        source.write_text(json.dumps(config))
        with patch("sys.argv", ["teek", "--config", str(source)]):
            teek.main()
            with self.assertRaises(FileExistsError):
                teek.main()
        cookie = self.login()
        status, _, body = self.request("GET", "/teek/rooms/fixture/", headers={"Cookie": cookie})
        self.assertEqual(status, 200)
        self.assertIn(b'/teek/rooms/fixture/api/jam', body)
        self.assertEqual(self.request("POST", "/teek/rooms/fixture/api/jam", "{}", {"Cookie": cookie, "Origin": "https://evil.example", "Content-Type": "application/json", "X-Jam-Request": "1"})[0], 403)
        self.assertFalse((Path(self.directory.name) / "archives").exists())

    def test_shared_engine_has_isolated_context_archive_quota_and_no_read_calls(self):
        profiles = [{"id": key, "name": key, "initials": key, "lens": "Test", "profile": "Synthetic profile", "ledger": "", "documents": [], "evidenceLabel": "Synthetic"} for key in ("pg", "achen")]
        calls = []
        def generate(**kwargs):
            calls.append(kwargs)
            return {"text": "Mock response", "model": "mock"}
        with tempfile.TemporaryDirectory() as directory:
            def make(slug):
                return TurriiJamStore(data_file=Path(directory)/slug/"jams.json", profiles=profiles, context=slug+" context", project_name=slug, topics=teek.DEFAULT_TOPICS, guardrails=teek.GUARDRAILS, generate=generate, ready=lambda: True, background=False)
            a, b = make("Alpha"), make("Beta")
            a.catalog(); b.catalog()
            self.assertEqual(calls, [])
            jam = a.create({"requestId": str(uuid.uuid4()), "topic": "wedge", "people": ["pg", "achen"], "text": "Some rough thoughts about this project and its users.", "consent": True})
            self.assertEqual(a.catalog()["used"], 1)
            self.assertEqual(b.catalog()["used"], 0)
            self.assertIn("Alpha context", calls[0]["system"])
            self.assertNotIn("Turrii", calls[0]["system"])
            self.assertNotIn("system", jam)
            self.assertEqual(make("Alpha").catalog()["used"], 1)
