import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import lab

spec = importlib.util.spec_from_file_location("example", ROOT / "examples/validator.py")
example = importlib.util.module_from_spec(spec)
spec.loader.exec_module(example)


class LabTests(unittest.TestCase):
    def test_reference_over_real_loopback_http(self):
        items = lab.cases()
        report = lab.run_adapter(items, [sys.executable, str(ROOT / "examples/validator.py"), "reference"])
        self.assertEqual(report["adapterErrors"], [])
        self.assertEqual(report["passed"], len(items))

    def test_naive_check_has_false_acceptance(self):
        r = lab.run_adapter(lab.cases(), [sys.executable, str(ROOT / "examples/validator.py"), "naive"])
        self.assertGreater(r["falseAcceptance"], 0)
        self.assertLess(r["passed"], r["total"])

    def test_always_unknown_cannot_pass_controls(self):
        items = lab.cases()
        r = lab.grade(items, [{"id": c["id"], "verdict": "unknown"} for c in items])
        self.assertGreater(r["missedAcceptance"], 0)
        self.assertLess(r["passed"], r["total"])

    def test_missing_duplicate_and_unknown_results(self):
        items = lab.cases()
        self.assertEqual(lab.grade(items, [])["missing"], len(items))
        a = {"id": items[0]["id"], "verdict": "unknown"}
        for bad in ([a, a], [{"id":"not-a-case", "verdict":"accepted"}], [{**a, "verdict":"maybe"}], {}):
            with self.assertRaises(ValueError):
                lab.grade(items, bad)

    def test_challenge_does_not_supply_answer_key(self):
        c = lab.challenge(lab.cases()[0], 12345)
        self.assertNotIn("expected", c)
        self.assertNotIn("response", c)
        self.assertTrue(c["synthetic"])

    def test_invalid_adapter_is_a_failure_not_a_pass(self):
        r = lab.run_adapter(lab.cases()[:1], [sys.executable, "-c", "print('not json')"])
        self.assertEqual(r["passed"], 0)
        self.assertEqual(r["missing"], 1)
        self.assertEqual(len(r["adapterErrors"]), 1)

    def test_example_rejects_external_url_before_network(self):
        c = lab.challenge(lab.cases()[0], 12345)
        c["url"] = "https://example.com/"
        with self.assertRaises(ValueError):
            example.request(c, lab.TOKEN)

    def test_positive_control_rejects_random_credential(self):
        c = next(c for c in lab.cases() if c["id"] == "valid-principal-control")
        server = lab.start_server([c])
        try:
            ch = lab.challenge(c, server.server_port)
            self.assertEqual(example.request(ch, lab.TOKEN)[0], 200)
            self.assertEqual(example.request(ch, lab.CONTROL)[0], 401)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
