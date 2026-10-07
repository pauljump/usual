"""Adapter examples, not a detector for real providers. Standard library only."""
import json
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


def request(challenge, token):
    u = urlsplit(challenge["url"])
    if u.scheme != "http" or u.hostname != "127.0.0.1" or u.username or u.password:
        raise ValueError("Example adapter permits loopback fixtures only")
    # Ignore environment proxy settings; synthetic values never leave loopback.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    req = urllib.request.Request(challenge["url"], method=challenge["method"],
                                 headers={"Authorization": "Bearer " + token})
    try:
        response = opener.open(req, timeout=2)
    except urllib.error.HTTPError as e:
        response = e
    with response:
        return response.status, response.read(65537)


def reference(c):
    if not c["authorityAllowed"]:
        return "unknown"
    # Historical successful responses don't establish current validity.
    if c.get("context", {}).get("cachedObservationAgeSeconds", 0) > 300:
        return "unknown"
    status, raw = request(c, c["credential"])
    if status == 401:
        return "rejected"
    if status != 200:
        return "unknown"
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return "unknown"
    if not isinstance(body, dict):
        return "unknown"
    if body.get("authenticated") is False:
        return "rejected"
    if body.get("authenticated") is not True or not body.get("principal"):
        return "unknown"
    negative_status, _ = request(c, c["invalidControl"])
    return "accepted" if negative_status == 401 else "unknown"


if __name__ == "__main__":
    c = json.load(sys.stdin)
    try:
        verdict = ("accepted" if request(c, c["credential"])[0] == 200 else "rejected") if sys.argv[-1] == "naive" else reference(c)
    except (OSError, ValueError):
        verdict = "unknown"
    print(json.dumps({"verdict": verdict}))
