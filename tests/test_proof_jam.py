import json
import tempfile
import unittest
import uuid
from pathlib import Path

from usual.proof_jam import LIMIT, MODEL, ROUNDS, JamError, ProofJamStore, context_text
from usual.jam_dialogue import EVIDENCE_STYLE, parse_dialogue


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


def dialogue(round_number=1, people=None):
    people = people or ["achen", "pg"]
    return json.dumps({"messages": [{"speaker": person, "text": "A direct reply to the preceding argument."} for person in (people if round_number == 4 else people * 2)],
                       "question": None if round_number == 4 else "Which part would you change?",
                       "summary": "The human's actual decision; unresolved risks remain." if round_number == 4 else None})


def opening():
    return {
        "requestId": str(uuid.uuid4()),
        "topic": "claim",
        "people": ["achen", "pg"],
        "text": "I keep wondering whether people need a proof badge or something else. These are rough thoughts, not a decision yet.",
    }


class ProofJamStoreTests(unittest.TestCase):
    def make_store(self, generate=None, ready=lambda: True):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        calls = []

        def fake_generate(**kwargs):
            calls.append(kwargs)
            return {"text": dialogue((len(kwargs["messages"]) + 1) // 2), "model": MODEL, "usage": {"output_tokens": 12}}

        store = ProofJamStore(
            data_file=Path(directory.name) / "jams.json",
            profiles=profiles(),
            context="Frozen Proof context",
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
        self.assertEqual(jam["status"], "waiting")
        self.assertEqual(len(jam["turns"][0]["dialogue"]["messages"]), 4)
        self.assertIsNone(jam["turns"][0]["dialogue"]["summary"])
        store.catalog()
        store.get(jam["id"])
        self.assertEqual(len(calls), 1)
        with self.assertRaises(JamError):
            store.submit(jam["id"], {"round": 2, "text": " "})
        self.assertEqual(len(calls), 1)
        for round_number in range(2, 5):
            jam = store.submit(jam["id"], {"round": round_number, "text": "My explicit contribution changes the next decision round."})
        self.assertEqual(len(calls), ROUNDS)
        self.assertEqual(jam["status"], "complete")
        self.assertTrue(jam["turns"][-1]["dialogue"]["summary"])
        self.assertIsNone(jam["turns"][-1]["dialogue"]["question"])
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

    def test_brain_dump_is_required_and_treated_as_context(self):
        store, calls = self.make_store()
        for text in (None, "   ", "short", "x" * 4001):
            bad = opening()
            bad["text"] = text
            with self.assertRaises(JamError):
                store.create(bad)
        self.assertEqual(store.catalog()["used"], 0)
        value = opening()
        jam = store.create(value)
        self.assertEqual(jam["turns"][0]["user"], value["text"])
        self.assertIn("unstructured brain dump", calls[0]["system"])
        self.assertIn("not a decision brief or a commitment", calls[0]["system"])

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

    def test_general_jam_is_default_and_keeps_full_context(self):
        store, calls = self.make_store()
        self.assertEqual(store.catalog()["topics"][0]["id"], "general")
        value = {**opening(), "topic": "general"}
        jam = store.create(value)
        self.assertEqual(jam["status"], "waiting")
        self.assertIn("Frozen Proof context", calls[0]["system"])

    def test_evidence_style_applies_to_existing_frozen_jams_without_rewriting_history(self):
        store, calls = self.make_store()
        jam = store.create(opening())
        first_answer = jam["turns"][0]["answer"]
        frozen = store.state["jams"][0]["system"]
        continued = store.submit(jam["id"], {"round": 2, "text": "Please explain the evidence in the conversation itself."})
        self.assertEqual(calls[-1]["system"], frozen + "\n\n" + EVIDENCE_STYLE)
        self.assertEqual(store.state["jams"][0]["system"], frozen)
        self.assertEqual(continued["turns"][0]["answer"], first_answer)
        self.assertEqual(continued["turns"][1]["responsePolicy"], EVIDENCE_STYLE)
        self.assertEqual(len(continued["turns"][1]["promptHash"]), 64)
        self.assertIn("Never invent a quotation", EVIDENCE_STYLE)

    def test_invalid_dialogue_cannot_advance_or_invent_human_turns(self):
        for changes in ({"summary": "too early"}, {"question": None}, {"messages": [{"speaker": "user", "text": "fake"}]}):
            value = {**json.loads(dialogue()), **changes}
            with self.assertRaises(ValueError):
                parse_dialogue(json.dumps(value), ["achen", "pg"], 1)
        store, _ = self.make_store(generate=lambda **kwargs: {"text": "A facilitator essay"})
        jam = store.create(opening())
        self.assertEqual(jam["status"], "error")
        self.assertNotIn("answer", jam["turns"][0])
        self.assertEqual(jam["attempts"], 1)

    def test_persisted_public_record_never_exposes_system_prompt(self):
        store, _ = self.make_store()
        jam = store.create(opening())
        self.assertNotIn("system", jam)
        persisted = json.loads(store.data_file.read_text())
        self.assertIn("system", persisted["jams"][0])


if __name__ == "__main__":
    unittest.main()
