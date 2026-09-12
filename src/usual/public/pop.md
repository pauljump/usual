# Usual Pop — independent install

Pop changes how a coding agent hands you an actionable link. It needs no history, Choices database, Usual account, or permission-setting changes.

Source: https://github.com/pauljump/usual · Local rule beta · MIT

## Installing agent: use the current user's request

Identify the active client from the current session. Supported instruction targets are Codex (`~/.codex/AGENTS.md`) and Claude Code (`~/.claude/CLAUDE.md`). A project-only request uses that project's `AGENTS.md` or `CLAUDE.md`. If the browser preference is missing, ask whether the user wants Chrome, Safari, or both. Do not ask again when the current request already supplies it. Do not install Choices or import history as a prerequisite.

With an inspected Usual source checkout or portable skill available, run its script by absolute path:

```sh
python3 /path/to/usual/scripts/usual.py pop install --client codex --browser both
```

Use `--client claude` for Claude and `--browser chrome` or `safari` for one browser. Use `--project /path/to/project` for a project-only rule. `--client-home /tmp/isolated-home` and the global `--home /tmp/private-data` support safe installation testing without changing the real account.

The installer changes only its marked block, preserves surrounding customization, refuses conflicting edits or unmarked legacy rules, and produces a private receipt. It stores installation metadata separately from historical evidence. The rule itself stores no history and makes no network calls. If there is an existing customized Pop section, inspect the difference and reconcile it under the user's current instruction before attempting the update; never overwrite it wholesale.

## If installing only the instruction

The installing agent may add a small managed `Usual Pop` block directly under the current task authorization, without installing the full skill. Preserve unrelated content. Use exactly one block and record the chosen client, file and browser so the user can remove that block later. If a prior block exists, show and reconcile conflicting edits.

The instruction's behavior is:

- Apply this format only to the URL the user is meant to act on. Citations and passing references stay ordinary links.
- For Chrome, replace `https://` with `googlechromes://` or `http://` with `googlechrome://` in the mobile link.
- For Safari, use `x-safari-https://` only for HTTPS. Omit its mobile link for plain HTTP.
- Keep the destination host, path, query and fragment unchanged. Encode Markdown delimiters when needed.
- Include an ordinary HTTP(S) Desktop link and a copyable URL. Desktop links use the default browser; do not claim they force a particular browser.
- The iOS links are scheme candidates whose actual navigation must be checked on the user's client/device. Do not label a scheme working based solely on OS registration.
- Do not open an app, change client permissions, allowlist shell commands or install another tool as an incidental part of this rule.

For both browsers, the HTTPS example is:

```markdown
[Chrome](googlechromes://example.com) · [Safari](x-safari-https://example.com) · [Desktop](https://example.com) · `https://example.com`
```

For one browser omit the other mobile link. Pop changes **agent output**. [Escape](https://tryusual.com/menu/escape/) is a separate website widget.

## Use and inspect the receipt

```sh
python3 /path/to/usual/scripts/usual.py pop use 'https://example.com' --browser both
python3 /path/to/usual/scripts/usual.py pop verify 'https://example.com'
python3 /path/to/usual/scripts/usual.py setup inspect
```

A formatter check verifies emitted links and the installed block. It does **not** prove that a fresh coding-agent session follows the instruction or that a real device opens the requested browser. Tell the user whether the rule was installed, whether a new session was checked, and which device navigation was actually observed. Do not turn one kind of test into another.

## Adjust or remove

Run `pop install` again with the new browser to update an unchanged managed block. Use `pop disable` or `pop remove` to remove only the owned block and preserve unrelated instructions and receipts. For a manually installed block, remove only the inspected Pop section; preserve everything else.

## Verification limits

The current local release verifies deterministic formatting, file targets, repeated installation, conflicting edits and removal under isolated homes. Fresh Codex/Claude behavior and physical-device navigation remain separate checks. Prior source notes report a macOS browser experiment, but those historical notes are not new cross-platform verification. The release does not claim universal iOS or desktop scheme behavior.

Human page: https://tryusual.com/pop/ · Menu: https://tryusual.com/#menu · Source: https://github.com/pauljump/usual
