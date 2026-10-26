# Usual Keyboard

Native iPhone keyboard with local correction and swipe typing, plus explicit Finish,
Rephrase and Expand actions. Source is maintained here in `pauljump/usual`.
This is separate from the Verhum/Cadence keyboard contribution.

## Source

- `ios/`: containing app and keyboard extension; generate with XcodeGen from `ios/project.yml`.
- `Vendor/HexKeyboard/`: adapted MIT keyboard engine with retained notices.
- `Core/`: earlier decoder and command-line tools.
- `service/`: optional private Mini service; provider credentials come from the vault.

## Checks

Run `swift test --package-path Core` for the portable decoder tests, and
`python3 -m unittest discover -s service -p 'test_*.py'` for the local service tests.
Native builds and device installs follow the portfolio Mini workflow.
Tests do not authorize model calls or device installation.

## Privacy and migration

Reusable source was imported from local commit
`a4d8f350f53388b9c29a71c4fd59db6e48e4b3e9` on 26 October 2026.
The old Git history contains personal material and is retained privately outside
this repository. Message fixtures, evaluation outputs, screenshots, personal word
counts and old vocabulary bundles were deliberately not imported.
A clean checkout starts without Paul's personal seed; normal local typing memory
still works. Private service training files are optional local runtime inputs under
ignored `eval/private/`. The installed phone app and its learning are unchanged.

The original checkout is retained at `usual/history/keyboard-original` for recovery.
Existing local `usual/keyboard` and `projects/telegraph` paths resolve here.
The private service's vault identity and app bundle identifiers stay compatible.
