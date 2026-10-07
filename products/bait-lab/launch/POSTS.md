# Launch copy — unsent

## Proposed first X post

Our fake Git credentials came back 8–10 days later. Fake Redis URLs got tried at a web login.

That became Bait Lab: 12 local tests for credential validators. Synthetic cases, actual code, no API keys.

Try 3 free. Full kit $29.
https://tryusual.com/bait/lab/

## Longer technical story for the product page or a later approved post

We put fake credentials on our own sites. Then we watched for them to come back.

By October 5, we'd recorded 380 submissions involving 124 distinct planted
credentials. The latest sample was 20 Git-remote submissions involving three
credential identifiers, roughly 8–10 days after first recorded collection.

The median time to first reuse was still 19 seconds. Eight credentials had their
first observed reuse after more than seven days. A single median hid the tail.

Earlier, four planted Redis URLs had been submitted to an HTTP login. That tells
us the values were reused, not that a Redis connection succeeded. And none of
these observations tells us what a scanner concluded.

The useful engineering question was smaller: what does a response actually prove?

We built a local regression kit around that question. There are synthetic cases
for untrusted endpoints, wrong-protocol submissions, stale observations, success
bodies returned for invalid controls, and ambiguous errors. Positive and negative
controls keep “unknown for everything” from passing.

The included deliberately naive status checker passes 2/12. The reference lab
adapter passes 12/12. Those are examples we wrote, not scores for any vendor.
The useful score is the one you get after connecting your own code.

Three cases are free. The complete, MIT-licensed version 0.1 download is $29.
Python's standard library is enough. There are no provider requests or model calls.

https://tryusual.com/bait/lab/

## Boundaries

No client user-agent, network, credential digest or person is called malicious.
No assertion that a named scanner produced false positives. No made-up savings,
customer quotes, scarcity, sales count or automatic future-release promise.
Do not post this into unrelated issue trackers or contact scanner operators.
