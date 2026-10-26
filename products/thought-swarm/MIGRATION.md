# Thought Swarm in Usual

Canonical code: `pauljump/usual`, `products/thought-swarm/`.
Local root: `/Users/mini-home/projects/usual/core/products/thought-swarm`.

On 26 October 2026, Paul requested consolidation into Usual. The complete standalone
history through `b93d2df57e6fdf7aa739731ca71a5f3026bafc72` was imported with a
non-squashed Git subtree merge, including all six previously unpublished commits.
The Apache-2.0 LICENSE remains scoped to this product.

The original checkout is retained at `/Users/mini-home/projects/usual/history/thought-swarm-original`
for recovery only, including the old preload log and local files. The old project path
is a compatibility symlink to the canonical product directory. Do not develop or deploy
from the historical checkout. No remote repository has been deleted or archived.

Run `npm run typecheck` and `npm test` in this directory. The Worker entrypoint,
Wrangler configuration and package lock stay product-local. Deploy from this directory
using vault-supplied Cloudflare credentials and the portfolio deployment policy.
The `thought-swarm` Worker, `thoughtswarm.tryusual.com` route, D1 database ID,
existing digests and share links are unchanged. Runtime secrets belong in the vault.

GitHub publication and the updated website source link are pending approval:
Usual already had nine unrelated unpublished commits before this import.
