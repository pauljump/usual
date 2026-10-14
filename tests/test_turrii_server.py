import http.client
import os
import threading
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

from usual.server import PublicAutopilotHandler, ThreadingHTTPServer


class TurriiServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.environment = patch.dict(os.environ, {"TURRII_JAM_PASSWORD": "test-only-password"}, clear=False)
        cls.environment.start()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), PublicAutopilotHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.host, cls.port = cls.server.server_address

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.environment.stop()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection(self.host, self.port, timeout=4)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read()
        result = response.status, dict(response.getheaders()), payload
        connection.close()
        return result

    def login(self):
        body = urlencode({"password": "test-only-password"})
        status, headers, _ = self.request("POST", "/turrii/login", body, {"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(status, 303)
        return headers["Set-Cookie"].split(";", 1)[0]

    def test_path_redirects_to_canonical_slash(self):
        status, headers, _ = self.request("GET", "/turrii")
        self.assertEqual(status, 308)
        self.assertEqual(headers["Location"], "/turrii/")

    def test_private_page_requires_password_and_is_not_indexable(self):
        status, headers, body = self.request("GET", "/turrii/")
        self.assertEqual(status, 200)
        self.assertIn(b"Workshop password", body)
        self.assertIn("noindex", headers["X-Robots-Tag"])
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])

    def test_wrong_password_is_rejected(self):
        body = urlencode({"password": "wrong"})
        status, _, response = self.request("POST", "/turrii/login", body, {"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(status, 401)
        self.assertIn(b"didn", response)

    def test_login_establishes_scoped_session_and_serves_workshop(self):
        cookie = self.login()
        status, headers, body = self.request("GET", "/turrii/", headers={"Cookie": cookie})
        self.assertEqual(status, 200)
        self.assertIn(b"What is Turrii", body)
        self.assertIn("private, no-store", headers["Cache-Control"])
        self.assertNotIn("TURRII_JAM_PASSWORD", body.decode())

    def test_api_requires_auth_and_rejects_cross_origin_writes(self):
        status, _, _ = self.request("GET", "/turrii/api/jam")
        self.assertEqual(status, 401)
        cookie = self.login()
        status, _, body = self.request(
            "POST", "/turrii/api/jam", "{}",
            {"Cookie": cookie, "Origin": "https://evil.example", "Content-Type": "application/json", "X-Jam-Request": "1"},
        )
        self.assertEqual(status, 403)
        self.assertIn(b"Same-origin", body)


if __name__ == "__main__":
    unittest.main()
