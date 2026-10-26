// Cloudflare Worker entry. arelay.to's A2A delivery POSTs to /a2a here, so
// nothing has to hold a live connection.

import Anthropic from "@anthropic-ai/sdk";
import { ClaudeDigester, DEFAULT_MODEL } from "./digest.js";
import { PageFetcher } from "./fetcher.js";
import { App } from "./http.js";
import { SwarmStore, d1Db } from "./store.js";
import { Swarm } from "./swarm.js";

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  SWARM_AGENT_SALT: string;
  PUBLIC_BASE_URL: string;
  SWARM_MODEL?: string;
  A2A_BEARER_TOKEN?: string;
  ARELAY_VERIFICATION_TOKEN?: string;
  MISSES_PER_HOUR?: string;
}

let app: App | null = null;
let initialized: Promise<void> | null = null;

function build(env: Env): App {
  const store = new SwarmStore(d1Db(env.DB));
  initialized ??= store.init();
  const swarm = new Swarm({
    store,
    fetcher: new PageFetcher(),
    digester: new ClaudeDigester(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), env.SWARM_MODEL || DEFAULT_MODEL),
    publicBaseUrl: env.PUBLIC_BASE_URL,
    agentSalt: env.SWARM_AGENT_SALT,
  });
  return new App({
    swarm,
    store,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    a2aBearerToken: env.A2A_BEARER_TOKEN,
    arelayVerificationToken: env.ARELAY_VERIFICATION_TOKEN,
    missesPerHour: env.MISSES_PER_HOUR ? Number(env.MISSES_PER_HOUR) : undefined,
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    app ??= build(env);
    await initialized;
    return app.handle(req);
  },
};
