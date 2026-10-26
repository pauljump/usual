// Claims arelay.to/<handle> for The Swarm with A2A delivery, following
// https://arelay.to/register. Three steps, run in order:
//   npx tsx scripts/claim-handle.ts register --domain swarm.example.com [--handle swarm]
//   (deploy with ARELAY_VERIFICATION_TOKEN set to the token it prints)
//   npx tsx scripts/claim-handle.ts verify
//   npx tsx scripts/claim-handle.ts status
// Secrets (cancellation cookie, management token) go to .arelay-registration.json
// with mode 600 and are never printed. That file is gitignored.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const API = "https://arelay.to/api/v1";
const STATE = ".arelay-registration.json";
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {});
const save = (s: unknown) => {
  writeFileSync(STATE, JSON.stringify(s, null, 2));
  chmodSync(STATE, 0o600);
};

const cmd = process.argv[2];
if (cmd === "register") {
  const domain = arg("domain");
  const handle = arg("handle") ?? "swarm";
  const bearerToken = process.env.A2A_BEARER_TOKEN;
  if (!domain) throw new Error("Pass --domain, the host The Swarm is deployed on.");
  if (!bearerToken) throw new Error("Set A2A_BEARER_TOKEN to the same value as the deployed secret, so only arelay.to can call /a2a.");
  const res = await fetch(`${API}/registrations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      handle,
      domain,
      displayName: "The Swarm",
      description:
        "The agent that has already read it. Send a public docs URL and get a dense digest, from the shared cache if another agent already read that page, with a receipt of the tokens saved.",
      delivery: { type: "a2a", agentCardUrl: `https://${domain}/.well-known/agent-card.json`, bearerToken },
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Registration failed (HTTP ${res.status}):`, body.error ?? body);
    process.exit(1);
  }
  const cookie = res.headers.get("set-cookie");
  save({ handle, domain, registrationId: body.registrationId, expiresAt: body.expiresAt, cancellationCookie: cookie });
  const challenge = body.challenge ?? {};
  const fileToken =
    challenge.file?.body ?? challenge.https?.body ?? challenge.httpsFile?.content ?? challenge.token ?? challenge.file?.token ?? null;
  console.log(`Registered ${handle} (id ${body.registrationId}), pending verification until ${body.expiresAt}.`);
  console.log("\nChallenge from arelay.to:\n" + JSON.stringify(challenge, null, 2));
  if (fileToken) {
    console.log(`\nNext: npx wrangler secret put ARELAY_VERIFICATION_TOKEN   (value: ${fileToken})`);
  } else {
    console.log("\nNext: set ARELAY_VERIFICATION_TOKEN to the bare token from the HTTPS file challenge above (wrangler secret put ARELAY_VERIFICATION_TOKEN).");
  }
  console.log(`Check it serves: curl https://${domain}/.well-known/arelay-verification.txt`);
  console.log("Then run: npx tsx scripts/claim-handle.ts verify");
} else if (cmd === "verify") {
  const s = load();
  if (!s.registrationId) throw new Error("Run register first.");
  const res = await fetch(`${API}/registrations/${s.registrationId}/verify`, { method: "POST" });
  const body: any = await res.json().catch(() => ({}));
  if (res.status === 200) {
    save({ ...s, managementToken: body.managementToken, verifiedAt: new Date().toISOString() });
    console.log(`Verified. arelay.to/${s.handle} now delivers to https://${s.domain}/a2a. The management token is saved in ${STATE}; move it to a secret manager.`);
  } else if (res.status === 202) {
    console.log("arelay.to sent its ownership challenge and is waiting. Try verify again in 30 seconds.");
  } else {
    console.error(`Verification not complete (HTTP ${res.status}):`, body.error ?? body);
    process.exit(1);
  }
} else if (cmd === "status") {
  const s = load();
  const handle = arg("handle") ?? s.handle ?? "swarm";
  const res = await fetch(`${API}/agents/${handle}`);
  console.log(`HTTP ${res.status}`, await res.text());
  if (s.managementToken) {
    const stats = await fetch(`${API}/agents/${handle}/manage/stats?window=7`, { headers: { authorization: `Bearer ${s.managementToken}` } });
    console.log(`\nLast 7 days (HTTP ${stats.status}):`, await stats.text());
  }
} else {
  console.log("Usage: claim-handle.ts register --domain <host> [--handle swarm] | verify | status");
}
