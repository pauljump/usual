// Local / single-host Node server: node:sqlite storage, optional Relay feed.
//   ANTHROPIC_API_KEY=... npm run dev
// Env: PORT, SWARM_DB (file path, default ./swarm.db), PUBLIC_BASE_URL, SWARM_MODEL,
// SWARM_AGENT_SALT, A2A_BEARER_TOKEN, ARELAY_VERIFICATION_TOKEN,
// RELAY_WORKSPACE_KEY + RELAY_FEED_TOKEN (optional live feed to #swarm-live).

import { createServer, type IncomingMessage } from "node:http";
import { ClaudeDigester, DEFAULT_MODEL } from "./digest.js";
import { createRelayFeed } from "./feed.js";
import { PageFetcher } from "./fetcher.js";
import { App } from "./http.js";
import { sqliteDb } from "./sqlite.js";
import { SwarmStore } from "./store.js";
import { Swarm, type ReadEvent } from "./swarm.js";

const port = Number(process.env.PORT ?? 8787);
const base = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;

const store = new SwarmStore(await sqliteDb(process.env.SWARM_DB ?? "./swarm.db"));
await store.init();

let onRead: ((e: ReadEvent) => Promise<void>) | undefined;
if (process.env.RELAY_WORKSPACE_KEY) {
  try {
    onRead = await createRelayFeed({ workspaceKey: process.env.RELAY_WORKSPACE_KEY, agentToken: process.env.RELAY_FEED_TOKEN, store });
    console.log("Relay live feed on #swarm-live");
  } catch (err) {
    console.warn("Relay feed disabled:", (err as Error).message);
  }
}

if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY is not set; cached pages work, new pages will fail to digest.");
if (!process.env.SWARM_AGENT_SALT) console.warn("SWARM_AGENT_SALT is not set; using a fixed development salt.");

const app = new App({
  swarm: new Swarm({
    store,
    fetcher: new PageFetcher(),
    digester: new ClaudeDigester(undefined, process.env.SWARM_MODEL || DEFAULT_MODEL),
    publicBaseUrl: base,
    agentSalt: process.env.SWARM_AGENT_SALT ?? "dev-salt",
    onRead,
  }),
  store,
  publicBaseUrl: base,
  a2aBearerToken: process.env.A2A_BEARER_TOKEN,
  arelayVerificationToken: process.env.ARELAY_VERIFICATION_TOKEN,
  missesPerHour: process.env.MISSES_PER_HOUR ? Number(process.env.MISSES_PER_HOUR) : undefined,
});

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  if (!headers.has("x-forwarded-for") && req.socket.remoteAddress) headers.set("x-forwarded-for", req.socket.remoteAddress);
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && chunks.length > 0;
  return new Request(new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`), {
    method: req.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
}

createServer(async (req, res) => {
  const response = await app.handle(await toRequest(req));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`The Swarm listening on ${base}`));
