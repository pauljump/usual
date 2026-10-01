#!/usr/bin/env python3
"""Review/apply only Bait Shopify's route on the existing Mini Tunnel."""
import argparse
import copy
import datetime
import json
import os
from pathlib import Path
import urllib.request

HOST = "bait-shopify.polyfeeds.dev"
TUNNEL = "446b30c6-5aca-42a1-be3c-786debad09ad"
ACCOUNT = "a90a0202b423bf9af3dec6e3b92d63e0"
ZONE = "a350c8d7ab8e8fec717a3ae9569b50f8"
SERVICE = "http://127.0.0.1:3087"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    values = {}
    for line in Path("/Users/mini-home/.secrets/monorepo.env").read_text().splitlines():
        line = line.strip().removeprefix("export ")
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    headers = {"X-Auth-Email": values["CLOUDFLARE_EMAIL"],
               "X-Auth-Key": values["CLOUDFLARE_API_KEY"], "Content-Type": "application/json"}

    def api(path, method="GET", body=None):
        request = urllib.request.Request("https://api.cloudflare.com/client/v4/" + path,
            headers=headers, method=method,
            data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
        if not result.get("success"):
            raise RuntimeError("Cloudflare operation failed; credentials omitted")
        return result["result"]

    route_path = f"accounts/{ACCOUNT}/cfd_tunnel/{TUNNEL}/configurations"
    dns_path = f"zones/{ZONE}/dns_records"
    before = api(route_path)
    config = before["config"]
    rules = config["ingress"]
    exact = [rule for rule in rules if rule.get("hostname") == HOST]
    expected = {"hostname": HOST, "service": SERVICE}
    if exact and exact != [expected]:
        raise RuntimeError("Existing Bait route differs; refusing replacement")
    dns = api(dns_path + "?name=" + HOST)
    cname = {"type": "CNAME", "name": HOST, "content": TUNNEL + ".cfargotunnel.com",
             "proxied": True, "ttl": 1}
    if dns and (len(dns) != 1 or any(dns[0].get(k) != cname[k] for k in ["type", "name", "content", "proxied"])):
        raise RuntimeError("Existing Bait DNS differs; refusing replacement")
    candidate = copy.deepcopy(config)
    if not exact:
        candidate["ingress"].insert(0, expected)
    summary = {"apply": args.apply, "hostname": HOST, "service": SERVICE,
               "createDns": not bool(dns), "addIngress": not bool(exact),
               "existingIngressRulesPreserved": len(rules),
               "newPaidServices": 0, "zoneSettingsChanges": 0}
    print(json.dumps(summary, indent=2))
    if not args.apply:
        return
    # Save the exact before-state privately, and reject drift before a full-config PUT.
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    receipt = Path.home() / ".usual/bait/deployments" / (stamp + "-shopify")
    receipt.mkdir(parents=True, mode=0o700)
    (receipt / "before-tunnel.json").write_text(json.dumps(before, indent=2))
    (receipt / "before-dns.json").write_text(json.dumps(dns, indent=2))
    if not exact:
        current = api(route_path)
        if current["config"] != config or current.get("version") != before.get("version"):
            raise RuntimeError("Tunnel changed during review; refusing stale update")
        api(route_path, "PUT", {"config": candidate})
        after = api(route_path)
        if after["config"] != candidate:
            raise RuntimeError("Tunnel verification differs; inspect before retrying")
        (receipt / "after-tunnel.json").write_text(json.dumps(after, indent=2))
    if not dns:
        # Recheck before creating so retries never deliberately duplicate records.
        if api(dns_path + "?name=" + HOST):
            raise RuntimeError("Bait DNS appeared concurrently; inspect before retrying")
        api(dns_path, "POST", cname)
    verified = api(dns_path + "?name=" + HOST)
    if len(verified) != 1 or any(verified[0].get(k) != cname[k] for k in ["type", "name", "content", "proxied"]):
        raise RuntimeError("DNS verification failed")
    (receipt / "after-dns.json").write_text(json.dumps(verified, indent=2))
    (receipt / "receipt.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({"verified": True, "privateReceipt": str(receipt)}))


if __name__ == "__main__":
    main()
