# Usual Pop

Pop the links your coding agent hands you into the browser you actually want — Chrome or Safari, on
phone or on desktop.

To install, tell Claude Code or Codex:

```
read https://tryusual.com/pop and install it
```

---

# Instructions for the installing agent

You are installing Usual Pop for your user. Work these four steps in order.

## 1. Work out which client you are — do not ask

You already know whether you are Claude Code or Codex. Only if genuinely ambiguous, check for
`~/.claude/` versus `~/.codex/`. Never make the user tell you.

| Client | Append the rule to |
| --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` |

Use the project-local `CLAUDE.md` or `AGENTS.md` instead if the user says this project only. If the
target file already contains a `## Usual Pop` section, replace it rather than appending a second copy.

## 2. Ask the user exactly two questions

Ask both together, then wait. Claude Code should use `AskUserQuestion`; Codex should ask in plain
text. Do not ask anything else, and do not ask which client they use.

**Question 1 — Which browser should links pop into?** Options: `Chrome`, `Safari`, `Both`.

**Question 2 — Also install Usual itself?** Options: `Yes`, `No`. Describe it in one sentence: Usual
is a skill that uses your past decisions to inform future coding choices. Offer the read-more links
in Pop's own format, since it doubles as a live demo of what they are installing:

```markdown
[Mobile → Chrome](googlechromes://tryusual.com) · [Mobile → Safari](x-safari-https://tryusual.com) · [Desktop](https://tryusual.com) · `https://tryusual.com`
```

If they answer Yes, finish the Pop install first, then follow `https://tryusual.com/learn.md`.

## 3. Append the matching block, verbatim

Paraphrasing loses the platform split and the limitation, which are the parts that matter. Copy one
block exactly as written.

### If they chose Chrome

```markdown
## Usual Pop

When handing the user a URL that is the point of the message, give three affordances on one line
rather than guessing what device they are on:

[Mobile → Chrome](googlechromes://example.com) · [Desktop](https://example.com) · `https://example.com`

- Mobile link: swap the scheme. `https://` becomes `googlechromes://`, `http://` becomes
  `googlechrome://`. Keep host, path, query, and fragment unchanged. This forces Chrome on iOS.
- Desktop link: the ordinary `https://` URL. It opens their default browser; no clickable link can
  force a browser on macOS, so never claim it does.
- Plain text: the written-out URL in backticks, for copy-paste.

If they are on desktop, Chrome is not their default, and I have shell access, run
`open -a "Google Chrome" "<url>"` — the only reliable way to force it there.

Apply this only to the link the user is meant to act on. Citations and passing references stay
ordinary links.
```

### If they chose Safari

```markdown
## Usual Pop

When handing the user a URL that is the point of the message, give three affordances on one line
rather than guessing what device they are on:

[Mobile → Safari](x-safari-https://example.com) · [Desktop](https://example.com) · `https://example.com`

- Mobile link: swap the scheme. `https://` becomes `x-safari-https://`. Keep host, path, query, and
  fragment unchanged. This forces Safari on iOS 17+. There is no `x-safari-http://`, so omit the
  mobile link for plain `http://` URLs.
- Desktop link: the ordinary `https://` URL. It opens their default browser; no clickable link can
  force a browser on macOS, so never claim it does.
- Plain text: the written-out URL in backticks, for copy-paste.

If they are on desktop, Safari is not their default, and I have shell access, run
`open -a "Safari" "<url>"` — the only reliable way to force it there. Safari is macOS and iOS only;
on Linux or Windows say so rather than substituting another browser.

Apply this only to the link the user is meant to act on. Citations and passing references stay
ordinary links.
```

### If they chose Both

```markdown
## Usual Pop

When handing the user a URL that is the point of the message, give four affordances on one line
rather than guessing what device or browser they are on:

[Chrome](googlechromes://example.com) · [Safari](x-safari-https://example.com) · [Desktop](https://example.com) · `https://example.com`

- Chrome link: `https://` becomes `googlechromes://`, `http://` becomes `googlechrome://`. Forces
  Chrome on iOS.
- Safari link: `https://` becomes `x-safari-https://`. Forces Safari on iOS 17+. No
  `x-safari-http://` exists, so omit it for plain `http://` URLs.
- Keep host, path, query, and fragment unchanged in both; only the scheme changes.
- Desktop link: the ordinary `https://` URL. It opens their default browser; no clickable link can
  force a browser on macOS, so never claim it does.
- Plain text: the written-out URL in backticks, for copy-paste.

If they are on desktop and I have shell access, `open -a "Google Chrome" "<url>"` or
`open -a "Safari" "<url>"` is the only reliable way to force a specific browser there.

Apply this only to the link the user is meant to act on. Citations and passing references stay
ordinary links.
```

## 4. Optionally allowlist, then verify and report

The links need no permissions. The desktop shell fallback does. Offer it; do not add it silently.

Claude Code, in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(open -a \"Google Chrome\":*)", "Bash(open -a \"Safari\":*)"]
  }
}
```

Codex has no per-command allowlist; the command falls under the existing `approval_policy` in
`~/.codex/config.toml`.

Then confirm the rule landed in the file, and demonstrate it once by sending the user a real link in
the installed format. Tell them the rule takes effect in a new session if the client caches
instructions.

---

# Reference: what actually works

Do not rediscover this. Verified on macOS 15 (Darwin 25.6) by checking LaunchServices registration
*and* firing each URL at a server whose access log was readable.

| Scheme | iOS | macOS |
| --- | --- | --- |
| `googlechromes://` (https), `googlechrome://` (http) | Opens Chrome | No handler; silently does nothing |
| `x-safari-https://` | Opens Safari, iOS 17+ | Registered to Safari.app but delivers zero requests |
| `google-chrome://` | — | Registered to Chrome.app but delivers zero requests |
| `open -a "<Browser>" "<url>"` | — | Works |

Two traps behind that table. Registration is not navigation: `google-chrome://` and
`x-safari-https://` both resolve to a real app on macOS via
`NSWorkspace.urlForApplication(toOpen:)` and still navigate nowhere, so a LaunchServices hit proves
nothing on its own. And a negative result on one platform says nothing about the other — the Chrome
schemes are dead on macOS and work fine on iPhone. That asymmetry is the entire reason Pop ships
multiple links instead of picking one.

A bare host works in the mobile schemes; `www.` is not required.

---

Source: https://github.com/pauljump/usual
Chrome for iOS scheme reference: https://chromium.googlesource.com/chromium/src/+/lkgr/docs/ios/opening_links.md
