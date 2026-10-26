// Move the canonical instance to a new public host: rewrites PUBLIC_BASE_URL,
// the custom-domain route and every doc, skill and script that names the
// current host. For your own instance, use scripts/go-live.sh <host> instead,
// which leaves these files alone.
//   node scripts/set-host.mjs new.host.name
import { readFileSync, writeFileSync } from "node:fs";

const host = process.argv[2]?.replace(/^https?:\/\//, "").replace(/\/$/, "");
if (!host) {
  console.error("Usage: node scripts/set-host.mjs <host>");
  process.exit(1);
}
const current = readFileSync("wrangler.toml", "utf8").match(/^PUBLIC_BASE_URL = "https?:\/\/([^"/]+)/m)?.[1];
if (!current) {
  console.error("Could not find PUBLIC_BASE_URL in wrangler.toml.");
  process.exit(1);
}
const files = ["README.md", "CONTRIBUTING.md", "docs/operations.md", "wrangler.toml", "skills/the-swarm/SKILL.md", "seeds/README.md", "scripts/preload.ts"];
for (const f of files) {
  try {
    const before = readFileSync(f, "utf8");
    const after = before.replaceAll(current, host);
    if (after !== before) writeFileSync(f, after);
    console.log(`${after === before ? "unchanged" : "updated  "} ${f}`);
  } catch {
    console.log(`missing   ${f}`);
  }
}
