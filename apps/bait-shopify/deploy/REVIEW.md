# Bait Shopify: development deployment review

Updated 2026-09-28 after the approved deployment. The backend and app version are published; installation is not yet complete.

## Completed

- Created a separate Bait registration in the existing Paul Jump organization through Shopify CLI.
- Client ID: `27297a7de66ce583214e00bb0dcfc8da` (public identifier).
- Selected existing development store `draft-documents-test-store.myshopify.com` locally.
- App credentials saved directly to `/Users/mini-home/.secrets/runtime/bait-shopify.env`, mode 0600; no values printed or saved in source.
- Initialized empty private SQLite at `/Users/mini-home/.usual/bait-shopify/development.sqlite`; applied the checked-in migration. No seeded scores or sessions.
- Added a stopped `bait-shopify` fleet definition with vault references and bounded restart settings.
- Native Shopify build and Theme Check passed after adding extension locale resources.
- Vault runner prerequisite check passed; fleet dry run selected one stopped service, apply false.
- Read-only Cloudflare checks found no existing exact DNS or tunnel rule for the proposed hostname.
- Shopify CLI automatically updated itself from 4.8.0 to 4.8.2 during registration.

## Approved deployment scope

1. Add only `bait-shopify.polyfeeds.dev` as a proxied CNAME to the existing `mini-dev` Tunnel.
2. Add an exact-host ingress rule to `http://127.0.0.1:3087`, preserving all existing rules and zone settings.
3. Change only the Bait fleet entry to online and start it through the canonical fleet/vault runner.
4. Publish Bait's app configuration and theme extension to its own Shopify registration, then install only on the development store.
5. Verify native Admin authentication, app-proxy signatures, theme embed activation, pause, and measured requests through Shopify. Keep development counts separate from the existing public Worker score.

No Shopify App Store listing, merchant outreach, production-store installation,
paid subscription, paid database, paid model call or data resale is part of this plan.
The Mini/Tunnel/SQLite route reuses existing infrastructure. This is not a guarantee
of unlimited free hosting at future scale. Quotas, uptime and normal maintenance remain.

## Boundaries

- Only scope: `write_app_proxy`.
- Only storefront route: `/apps/bait` and its descendants, routed to `/proxy`.
- No access to real products, orders or customer records; trap collection starts disabled.
- Existing Cloudflare Bait Worker remains separate and unchanged.
- HTTP login-page health is not a substitute for testing a signed proxy request and real Admin install.
- Do not run Shopify CLI's default public preview tunnel as a workaround for route approval.

## Pending

The development-store install screen was reached on September 28; its browser session may expire. Shopify displays owner contact-data access plus
Online Store content on the app-controlled path. Installation awaits confirmation at this access
grant. Admin authentication, theme activation, signed proxy delivery and live counters have not
yet been verified. No real Shopify bot interactions are claimed.

## Rollback scope after deployment

Pause traps and disable the theme embed first. Stop only the Bait runtime and remove only
its new ingress/DNS entries if needed, after appropriate authorization. Preserve the private
database and existing app registration for diagnosis; do not delete records or other apps.

## Applied and verified

- Started only `bait-shopify` through the canonical fleet/vault runner; status online.
- Ran `python3 scripts/deploy-route.py` (dry run), then `--apply` from this package.
- Added the exact-host ingress and proxied DNS CNAME, preserving all 146 prior rules.
- Private route before/after receipt: `/Users/mini-home/.usual/bait/deployments/20260929T011229Z-shopify`.
- Local and canonical HTTPS `/auth/login` returned HTTP 200 with the login page.
- Published Shopify version [bait-dev-20260928](https://dev.shopify.com/dashboard/129038148/apps/429247987713/versions/1147491942401); Theme Check and extension bundling passed.
- No new paid service, plan upgrade, listing or production-store installation was created.

Shopify's install grant includes owner contact data even though the only configured scope is
`write_app_proxy`. Trap observations exclude these fields; the official session adapter's
schema can retain identity fields as authentication data.
