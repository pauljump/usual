# Gumroad listing — prepared, not published

Product name: Bait Lab — Credential Verification Regression Kit
Type: digital product / software download
Price: USD 29, one-time; no subscription or pay-what-you-want toggle
Deliverable: `delivery/bait-lab-0.1.zip` from the verified build
Free sample: `public/bait-lab-sample.zip`
License: MIT, full source, commercial use and redistribution permitted
Proposed refund offer: request a refund within 14 days of purchase
Updates: this version only; no recurring release promise
Suggested slug: bait-lab
Canonical marketing URL after approved publication: https://tryusual.com/bait/lab/

## Description to publish

Does your credential validator mistake a response for proof that a key works?

Bait Lab gives you 12 synthetic regression cases and a small local runner:
untrusted Git endpoints, a Redis-shaped credential at a web login, misleading
HTTP 200 responses, invalid controls, stale observations, and inconclusive errors.

Run the sample, plug in your own adapter, and get a JSON report plus a CI-friendly
exit code. Python 3.11+ is the only dependency. No accounts, provider API calls,
real credentials, model calls or hosted runtime are required.

Included: all 12 cases with expected outcomes and explanations, local HTTP fixture
server, example adapters, tests, field notes, and full MIT-licensed source.

Three cases are available in the free sample. This purchase buys the prepared
complete release; it does not buy exclusive rights to the source or field data.

This is for developers who can connect their own HTTP verification logic through
a process adapter. It is not a plug-in for every scanner, a security certification,
an attack feed, or a real-provider test. All cases are synthetic. The field notes
explain which exercises were inspired by Bait observations and which are controls.

One-time purchase, version 0.1. No automatic renewal or promised future releases.
Request a refund within 14 days of purchase.

## Delivery instructions

Unzip, open the bait-lab directory, then run:

```sh
python3 lab.py demo
python3 lab.py run -- python3 examples/validator.py reference
```

Read README.md to connect your own adapter. A 12/12 reference score proves the
examples work; run your own code before treating the result as your coverage.
No telemetry is sent. For a reproducible pack defect, include the case ID and
Python version in the purchase-platform support thread; never send real secrets.

## Launch operator steps (after explicit authorization)

1. Use an existing authorized Gumroad seller account; verify payout readiness.
2. Create the exact digital product above, upload only the full delivery ZIP, and
   copy the approved refund terms. Don't promise custom integration or on-call support.
3. Verify delivery in the provider's supported preview/test flow; do not make a
   chargeable self-purchase without separate spending authorization.
4. Use its actual product URL with `build.py --checkout URL --out NEW_DIRECTORY`.
5. Follow the portfolio deployment policy and existing Tunnel playbook. Set
   `USUAL_BAIT_LAB_PUBLIC_DIR` to the generated **public** directory in the
   control-plane `usual-web` fleet registry environment, then restart only that
   service through its documented vault runner. The disabled-by-default server
   integration already maps the three public assets under `/bait/lab/`. Preserve the existing
   Worker `/bait/live/` routing. Do not publish the full download directory.
6. Verify page, free download, checkout product/price, and authorized delivery.
7. Publish the separately approved short X post in POSTS.md. No DMs or bulk posting.
8. Record the real launch time and actual receipts. Do not seed sales or reviews.
