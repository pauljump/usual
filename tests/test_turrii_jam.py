import json
import tempfile
import unittest
import uuid
from pathlib import Path

from usual.turrii_jam import LIMIT, MODEL, ROUNDS, JamError, TurriiJamStore, context_text


def profiles():
    return [
        {
            "id": "achen", "name": "Andrew Chen", "initials": "AC", "lens": "Distribution",
            "profile": "A bounded public decision profile.", "ledger": "",
            "documents": [{"path": "corpus/source.md", "text": "Retention and network adoption require repeated user value."}],
            "evidenceLabel": "1 retained text",
        },
        {
            "id": "pg", "name": "Paul Graham", "initials": "PG", "lens": "User need",
            "profile": "A bounded public decision profile.", "ledger": "",
            "documents": [{"path": "corpus/source.md", "text": "Start with a small group who urgently need the product."}],
            "evidenceLabel": "1 retained text",
        },
    ]


def opening():
    return {
        "requestId": str(uuid.uuid4()),
        "topic": "claim",
        "people": ["achen", "pg"],
        "opening": {
            "decision": "Which claim can this product defend in a real buyer workflow?",
            "position": "I think observed input facts are stronger than a universal human score.",
            "constraint": "We have one week, and repeated checker use would change my mind.",
        },
        "consent": True,
    }


class TurriiJamStoreTests(unittest.TestCase):
    def make_store(self, generate=None, ready=lambda: True):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        calls = []

        def fake_generate(**kwargs):
            calls.append(kwargs)
            return {"text": "A bounded mock response. What evidence changes the decision?", "model": MODEL, "usage": {"output_tokens": 12}}

        store = TurriiJamStore(
            data_file=Path(directory.name) / "jams.json",
            profiles=profiles(),
            context="Frozen Turrii context",
            generate=generate or fake_generate,
            ready=ready,
            background=False,
        )
        return store, calls

    def test_create_is_idempotent_and_quota_is_durable(self):
        store, calls = self.make_store()
        value = opening()
        first = store.create(value)
        self.assertEqual(store.create(value)["id"], first["id"])
        self.assertEqual(len(calls), 1)
        store.create(opening())
        self.assertEqual(store.catalog()["remaining"], 0)
        with self.assertRaisesRegex(JamError, "Both workspace"):
            store.create(opening())
        self.assertEqual(LIMIT, 2)

    def test_four_rounds_require_four_human_contributions(self):
        store, calls = self.make_store()
        jam = store.create(opening())
        for round_number in range(2, 5):
            jam = store.submit(jam["id"], {"round": round_number, "text": "My explicit contribution changes the next decision round."})
        self.assertEqual(len(calls), ROUNDS)
        self.assertEqual(jam["status"], "complete")
        self.assertEqual(len(jam["turns"]), ROUNDS)
        with self.assertRaises(JamError):
            store.submit(jam["id"], {"round": 5, "text": "There must not be an autonomous fifth round."})

    def test_validation_and_unavailable_provider_consume_no_slot(self):
        store, _ = self.make_store(ready=lambda: False)
        with self.assertRaisesRegex(JamError, "not configured"):
            store.create(opening())
        self.assertEqual(store.catalog()["used"], 0)
        available, _ = self.make_store()
        bad = opening()
        bad["people"] = ["../../secret", "pg"]
        with self.assertRaisesRegex(JamError, "available profiles"):
            available.create(bad)
        self.assertEqual(available.catalog()["used"], 0)

    def test_provider_failure_is_saved_without_retry(self):
        calls = []

        def fail(**kwargs):
            calls.append(kwargs)
            raise RuntimeError("test failure")

        store, _ = self.make_store(generate=fail)
        jam = store.create(opening())
        self.assertEqual(len(calls), 1)
        self.assertEqual(jam["status"], "error")
        self.assertIn("No automatic retry", jam["error"])

    def test_context_contains_the_full_decision_surface(self):
        context = context_text()
        for marker in (
            "What the mechanism can and cannot establish",
            "Demand and who pays",
            "Product-shape tension",
            "Agent-side opportunity",
            "Candidate tests",
            "Authorized voice",
        ):
            self.assertIn(marker, context)

    def test_persisted_public_record_never_exposes_system_prompt(self):
        store, _ = self.make_store()
        jam = store.create(opening())
        self.assertNotIn("system", jam)
        persisted = json.loads(store.data_file.read_text())
        self.assertIn("system", persisted["jams"][0])


if __name__ == "__main__":
    unittest.main()

