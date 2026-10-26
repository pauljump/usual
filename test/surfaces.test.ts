import { describe, expect, it } from "vitest";
import { pageHtml, setup } from "./helpers.js";

const URL1 = "https://nodejs.org/api/sqlite.html";

function mcp(app: any, body: unknown, session?: string) {
  return app.handle(
    new Request("https://swarm.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

describe("MCP endpoint", () => {
  it("initializes, lists tools and reads a page through the swarm", async () => {
    const { app, web } = await setup();
    web.pages.set(URL1, { body: pageHtml("SQLite docs.") });

    const init = await mcp(app, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    const session = init.headers.get("mcp-session-id");
    const initBody: any = await init.json();
    expect(initBody.result.protocolVersion).toBe("2025-06-18");
    expect(initBody.result.capabilities.tools).toBeDefined();
    expect(session).toBeTruthy();

    expect((await mcp(app, { jsonrpc: "2.0", method: "notifications/initialized" }, session!)).status).toBe(202);

    const list: any = await (await mcp(app, { jsonrpc: "2.0", id: 2, method: "tools/list" }, session!)).json();
    expect(list.result.tools.map((t: any) => t.name)).toEqual(["read_page", "swarm_stats"]);

    const call: any = await (await mcp(app, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_page", arguments: { url: URL1 } } }, session!)).json();
    expect(call.result.isError).toBeUndefined();
    expect(call.result.content[0].text).toContain("⬡ swarm receipt");
    expect(call.result.content[0].text).toContain("SQLite docs.");
    expect(call.result.structuredContent).toBeUndefined();

    const stats: any = await (await mcp(app, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "swarm_stats", arguments: {} } }, session!)).json();
    expect(stats.result.content[0].text).toContain("1 reads to 1 agents");
  });

  it("counts new sessions from the same address as the same agent", async () => {
    const { app, web } = await setup();
    web.pages.set(URL1, { body: pageHtml("SQLite docs.") });
    const read = async (id: number) => {
      const init = await mcp(app, { jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
      return (await mcp(app, { jsonrpc: "2.0", id: id + 1, method: "tools/call", params: { name: "read_page", arguments: { url: URL1 } } }, init.headers.get("mcp-session-id")!)).json();
    };
    await read(1);
    const second: any = await read(3);
    expect(second.result.content[0].text).toContain("1 agent has read this page");
  });

  it("reports read failures as tool errors, not protocol errors", async () => {
    const { app } = await setup();
    const call: any = await (await mcp(app, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_page", arguments: { url: "http://localhost/x" } } })).json();
    expect(call.result.isError).toBe(true);
    expect(call.result.content[0].text).toContain("Only public pages");
  });

  it("refuses SSE streams", async () => {
    const { app } = await setup();
    expect((await app.handle(new Request("https://swarm.example/mcp"))).status).toBe(405);
  });
});

describe("seeding", () => {
  const seed = (app: any, token?: string) =>
    app.handle(new Request(`https://swarm.example/read?seed=1&url=${encodeURIComponent(URL1)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

  it("needs the admin token", async () => {
    const { app } = await setup();
    expect((await seed(app)).status).toBe(401);
    expect((await seed(app, "wrong")).status).toBe(401);
  });

  it("digests the page without counting a read, so the first real agent gets a cache hit", async () => {
    const { app, web, store, digester } = await setup({ missesPerHour: 0 });
    web.pages.set(URL1, { body: pageHtml("Seeded.") });
    expect((await seed(app, "admin-secret")).status).toBe(200);
    expect((await store.totals()).reads).toBe(0);
    const first: any = await (await app.handle(new Request(`https://swarm.example/read?agent=a&url=${encodeURIComponent(URL1)}`))).json();
    expect(first.receipt.hit).toBe(true);
    expect(first.receipt.tokens_saved).toBeGreaterThan(0);
    expect(digester.calls).toBe(1);
  });
});

describe("public pages", () => {
  it("serves the scoreboard to browsers and plain usage to curl", async () => {
    const { app } = await setup();
    const browser = await app.handle(new Request("https://swarm.example/", { headers: { accept: "text/html" } }));
    expect(browser.headers.get("content-type")).toContain("text/html");
    const page = await browser.text();
    expect(page).toContain("claude mcp add --transport http swarm https://swarm.example/mcp");
    expect(page).not.toMatch(/relay/i);
    const curl = await (await app.handle(new Request("https://swarm.example/"))).text();
    expect(curl).toContain("claude mcp add");
  });

  it("serves a domain page and a badge", async () => {
    const { app, web } = await setup();
    web.pages.set(URL1, { body: pageHtml("Docs.") });
    for (const a of ["a", "b", "c"]) await app.handle(new Request(`https://swarm.example/read?agent=${a}&url=${encodeURIComponent(URL1)}`));
    const page = await (await app.handle(new Request("https://swarm.example/p/nodejs.org", { headers: { accept: "text/html" } }))).text();
    expect(page).toContain("How AI agents read nodejs.org");
    expect(page).toContain("nodejs.org/api/sqlite.html");
    expect(page).toContain("/badge/nodejs.org.svg");
    const badge = await app.handle(new Request("https://swarm.example/badge/nodejs.org.svg"));
    expect(badge.headers.get("content-type")).toBe("image/svg+xml");
    expect(await badge.text()).toContain("read by agents: 3");
  });
});
