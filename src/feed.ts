// Posts every public read to an Agent Relay channel (#swarm-live). An Observer
// link on that channel is the raw live feed on the launch page:
//   agent-relay observer --channels swarm-live --expires 7d
//
// Only pages that clear the public privacy threshold are posted, same as /stats.

import { AgentRelay } from "@agent-relay/sdk";
import { compact, type ReadEvent } from "./swarm.js";
import { PUBLIC_MIN_AGENTS, type SwarmStore } from "./store.js";

export const FEED_CHANNEL = "swarm-live";

export interface RelayFeedConfig {
  workspaceKey: string;
  agentToken?: string; // persisted token for the swarm-feed agent; registers one if absent
  store: SwarmStore;
}

export async function createRelayFeed(cfg: RelayFeedConfig): Promise<(e: ReadEvent) => Promise<void>> {
  const relay = new AgentRelay({ workspaceKey: cfg.workspaceKey });
  const agent = cfg.agentToken
    ? await relay.workspace.reconnect({ apiToken: cfg.agentToken })
    : await relay.workspace.register({ name: "swarm-feed", type: "agent" });
  try {
    await agent.channels.create({ name: FEED_CHANNEL, topic: "Every page The Swarm serves, live" });
  } catch {
    // Already exists.
  }
  await agent.channels.join(FEED_CHANNEL).catch(() => {});

  return async (e) => {
    const stats = await cfg.store.pageStats(e.url);
    if (stats.agents < PUBLIC_MIN_AGENTS) return;
    const line = e.hit
      ? `⬡ ${e.url} served from cache · ${e.tokens_saved.toLocaleString("en-US")} tokens saved · ${stats.agents} agents · ${compact(stats.tokens_saved)} saved on this page`
      : `⬡ ${e.url} new version digested · ${stats.agents} agents have read this page`;
    await agent.sendMessage({ to: `#${FEED_CHANNEL}`, text: line });
  };
}
