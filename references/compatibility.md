# Compatibility and integration map

| Existing entry | Local release behavior |
| --- | --- |
| `$usual`, `/usual`, installed skill | Preserved; collection instructions are additive. |
| Choices CLI and `--db` | Existing parser, data model, run/review semantics retained. |
| `~/.usual/judgment.sqlite3`, Whetstone migration | No collection database migration; previous links/backup semantics retained. |
| `/learn.md` | Portable installation plus menu/discovery guidance. |
| `/pop`, `/pop/`, `/pop/install` | Human page and simple agent-readable rule installation retained. |
| `/menu/{id}/`, `/{id}/install`, `/{id}/use` | Six catalog-backed pages and agent-readable commands. |
| Existing memory/reading-list/privacy/install routes | Still served with their existing meanings; homepage is the new collection. |
| `/usual.zip`, `/whetstone.zip` | Source allowlist download; old download redirect retained. |
| Existing Usual host aliases | Canonical redirects preserved; no DNS/route changes made. |
| Vibecheck upstream field-guide URLs and legacy cards | Left intact upstream; linked as guides. No upstream migration or redirect performed. |
| Escape upstream repository | Remains canonical; pinned MIT distribution with documented patch. |

New private setup/history/routines remain outside repositories and separate from old Choices data. A shared catalog version is not a claim of equal maturity or support across the items.

Reviewable local integration preserves all inherited tracked edits and untracked inputs. Private preservation records contain the canonical starting status, tracked diff and source hashes. Publication must first recheck those hashes and reconcile any newer user changes; never overwrite the dirty live tree wholesale.
