# Verification boundaries

This file records what the local release tests establish. Exact run counts and visual evidence are in `IMPLEMENTATION-STATUS.md` and the local release review record.

- **Deterministic fixtures:** native history parsing, role/metadata filtering, fork deduplication, source pointers, scope/exceptions/empty findings, report validation and corrections, file-check routine runs and receipts, source preservation, setup install/update/conflict/removal, recipe allowlisting and separate recipient use.
- **Existing Choices tests:** documented `python3 -m pytest -q`; original baseline before the release work: 185 passed, 5 skipped. The skips are retained experimental checks, not counted as proof.
- **Source foundation:** Transcript Mine's relevant adapters/index suite passed 15 tests read-only; no source repository was modified.
- **Scripted browser clients:** public website controls and mobile layout, explicit sample/handoff copy, route/content types, social metadata, and Escape rendering with synthetic user agents. A scripted user agent cannot establish physical-device behavior.
- **Portable installation:** source-only ZIP under isolated homes, invocation after moving the source checkout, repeated install and preservation of extra/modified files; no real client-global settings touched.

**Still separate:** fresh live Codex/Claude sessions following Pop/Usual, actual browser navigation on new device/client combinations, Linux/Windows or other history clients, real-user discovery usefulness and decision accuracy. No paid-provider call was made to simulate these checks. No analytics count, hours saved, grade, quota availability or user total is claimed.

Escape's upstream reports X on iPhone 12.21/iOS 26.6; this release has not independently revalidated that device. Other app menu wording and browser escape behavior remain limited. iOS escape requires a user action; automatic escape is not promised.

The synthetic flagship's `file-check-v1` verifies file existence, nonempty content, SHA-256, JSON syntax and supplied expected hashes. It does not run project tests or establish release readiness. Public output is a deliberate projection of those checks, not the private execution report.
