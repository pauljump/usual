// Point every doc, the skill and the deploy config at the real public host.
//   node scripts/set-host.mjs swarm.yourdomain.com
import { readFileSync, writeFileSync } from "node:fs";

const host = process.argv[2]?.replace(/^https?:\/\//, "").replace(/\/$/, "");
if (!host) {
  console.error("Usage: node scripts/set-host.mjs <host>");
  process.exit(1);
}
const files = ["README.md", "LAUNCH.md", "wrangler.toml", "skills/the-swarm/SKILL.md", "seeds/README.md", "scripts/preload.ts"];
for (const f of files) {
  try {
    const before = readFileSync(f, "utf8");
    const after = before.replaceAll("swarm.example.com", host);
    if (after !== before) writeFileSync(f, after);
    console.log(`${after === before ? "unchanged" : "updated  "} ${f}`);
  } catch {
    console.log(`missing   ${f}`);
  }
}
