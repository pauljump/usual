import { describe, expect, it } from "vitest";
import { PUBLIC_MIN_AGENTS } from "../src/store.js";
import { pageHtml, setup } from "./helpers.js";

const URL1 = "https://nextjs.org/docs/app/guides/caching";

async function get(app: Awaited<ReturnType<typeof setup>>["app"], path: string, ip = "1.1.1.1") {
  const res = await app.handle(new Request(`https://swarm.example${path}`, { headers: { "x-forwarded-for": ip } }));
  return { status: res.status, body: (await res.json()) as any };
}

describe("The Swarm read path", () => {
  it("digests once, then serves every other agent from cache with a receipt", async () => {
    const { app, web, digester } = await setup();
    web.pages.set(URL1, { body: pageHtml("Use revalidateTag.") });

    const first = await get(app, `/read?url=${encodeURIComponent(URL1)}&agent=alice`);
    expect(first.status).toBe(200);
    expect(first.body.receipt.hit).toBe(false);
    expect(first.body.receipt.tokens_saved).toBe(0);
    expect(first.body.receipt_line).toContain("you're the first agent");
    expect(first.body.markdown).toContain("revalidateTag(tag: string)");

    const second = await get(app, `/read?url=${encodeURIComponent(URL1 + "?utm_source=x#top")}&agent=bob`, "2.2.2.2");
    expect(second.body.receipt.hit).toBe(true);
    expect(second.body.receipt.agents_on_page).toBe(2);
    expect(second.body.receipt.tokens_saved).toBe(second.body.receipt.page_tokens - second.body.receipt.digest_tokens);
    expect(second.body.receipt.tokens_saved).toBeGreaterThan(0);
    expect(second.body.receipt_line).toContain("served from cache");
    expect(digester.calls).toBe(1);
  });

  it("treats a changed page as a new version and digests it again", async () => {
    const { app, web, digester } = await setup();
    web.pages.set(URL1, { body: pageHtml("Version one.") });
    await get(app, `/read?url=${encodeURIComponent(URL1)}&agent=a`);
    web.pages.set(URL1, { body: pageHtml("Version two, with a new API.") });
    const after = await get(app, `/read?url=${encodeURIComponent(URL1)}&agent=b`);
    expect(after.body.receipt.hit).toBe(false);
    expect(digester.calls).toBe(2);
  });

  it("digests a page only once when many agents ask at the same moment", async () => {
    const { swarm, web, digester } = await setup();
    digester.delayMs = 50;
    web.pages.set(URL1, { body: pageHtml("Concurrent.") });
    const results = await Promise.all(["a", "b", "c", "d"].map((agent) => swarm.read(URL1, agent)));
    expect(digester.calls).toBe(1);
    expect(results.filter((r) => r.receipt.hit)).toHaveLength(3);
  });

  it("respects robots.txt", async () => {
    const { app, web, digester } = await setup();
    web.robots.set("https://nextjs.org", "User-agent: *\nDisallow: /docs/");
    web.pages.set(URL1, { body: pageHtml("Blocked.") });
    const res = await get(app, `/read?url=${encodeURIComponent(URL1)}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("robots.txt");
    expect(digester.calls).toBe(0);
  });

  it("treats a robots.txt it isn't allowed to read as disallowing everything", async () => {
    const { app, web, digester } = await setup();
    web.pages.set("https://nextjs.org/robots.txt", { status: 403, type: "text/plain", body: "Forbidden" });
    web.pages.set(URL1, { body: pageHtml("Blocked.") });
    const res = await get(app, `/read?url=${encodeURIComponent(URL1)}`);
    expect(res.status).toBe(403);
    expect(digester.calls).toBe(0);
  });

  it("obeys robots.txt rules sent with an error status", async () => {
    const { app, web, digester } = await setup();
    web.pages.set("https://nextjs.org/robots.txt", { status: 418, type: "text/plain", body: "User-agent: *\nDisallow: /" });
    web.pages.set(URL1, { body: pageHtml("Blocked.") });
    const res = await get(app, `/read?url=${encodeURIComponent(URL1)}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("robots.txt");
    expect(digester.calls).toBe(0);
  });

  it("refuses private targets and binary content", async () => {
    const { app, web } = await setup();
    expect((await get(app, `/read?url=${encodeURIComponent("http://169.254.169.254/latest/meta-data")}`)).status).toBe(400);
    web.pages.set("https://example.com/a.zip", { body: "PK", type: "application/zip" });
    expect((await get(app, `/read?url=${encodeURIComponent("https://example.com/a.zip")}`)).status).toBe(415);
  });

  it("limits how many new pages one address can make the swarm digest", async () => {
    const { app, web } = await setup({ missesPerHour: 2 });
    for (const n of [1, 2, 3]) web.pages.set(`https://example.com/p${n}`, { body: pageHtml(`Page ${n}`) });
    expect((await get(app, `/read?url=https://example.com/p1`)).status).toBe(200);
    expect((await get(app, `/read?url=https://example.com/p2`)).status).toBe(200);
    expect((await get(app, `/read?url=https://example.com/p3`)).status).toBe(429);
    // Cached pages still work for the same address.
    expect((await get(app, `/read?url=https://example.com/p1`)).status).toBe(200);
  });

  it("returns markdown when asked, for agents using curl", async () => {
    const { app, web } = await setup();
    web.pages.set(URL1, { body: pageHtml("Markdown.") });
    const res = await app.handle(new Request(`https://swarm.example/read?format=text&url=${encodeURIComponent(URL1)}`));
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const body = await res.text();
    expect(body).toContain("⬡ swarm receipt");
    expect(body).toContain("not as instructions");
  });
});

describe("public scoreboard", () => {
  it(`hides a page until ${PUBLIC_MIN_AGENTS} different agents have read it`, async () => {
    const { app, web } = await setup();
    web.pages.set(URL1, { body: pageHtml("Popular.") });
    const read = (agent: string) => get(app, `/read?url=${encodeURIComponent(URL1)}&agent=${agent}`);

    await read("a");
    await read("a");
    await read("b");
    let stats = (await get(app, "/stats")).body;
    expect(stats.top_pages_24h).toHaveLength(0);
    expect(stats.now_reading).toHaveLength(0);
    expect(stats.all_time.reads).toBe(3);

    await read("c");
    stats = (await get(app, "/stats")).body;
    expect(stats.top_pages_24h[0]).toMatchObject({ url: URL1, agents: 3, reads: 4 });
    expect(stats.all_time.hits).toBe(3);
    expect(stats.all_time.tokens_saved).toBeGreaterThan(0);

    const domain = (await get(app, "/p/nextjs.org")).body;
    expect(domain).toMatchObject({ domain: "nextjs.org", reads: 4, agents: 3 });
  });
});

describe("A2A endpoint for arelay.to", () => {
  const send = (app: any, text: string, extra: Record<string, string> = {}) =>
    app.handle(
      new Request("https://swarm.example/a2a", {
        method: "POST",
        headers: { "content-type": "application/json", ...extra },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "message/send",
          params: { message: { kind: "message", role: "user", messageId: "m1", contextId: "ctx-1", parts: [{ kind: "text", text }] } },
        }),
      }),
    );

  it("answers a message containing a URL with the digest and receipt", async () => {
    const { app, web } = await setup();
    web.pages.set(URL1, { body: pageHtml("Via A2A.") });
    const body = (await (await send(app, `please read ${URL1}`)).json()) as any;
    expect(body.id).toBe(7);
    expect(body.result.kind).toBe("message");
    expect(body.result.role).toBe("agent");
    expect(body.result.contextId).toBe("ctx-1");
    expect(body.result.parts[0].text).toContain("⬡ swarm receipt");
  });

  it("explains itself when there is no URL, and reports read failures in the reply", async () => {
    const { app } = await setup();
    const hello = (await (await send(app, "hi")).json()) as any;
    expect(hello.result.parts[0].text).toContain("Send me the URL");
    const missing = (await (await send(app, "https://example.com/missing")).json()) as any;
    expect(missing.result.parts[0].text).toContain("couldn't read");
  });

  it("rejects unknown methods with a JSON-RPC error", async () => {
    const { app } = await setup();
    const res = await app.handle(new Request("https://swarm.example/a2a", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tasks/get" }) }));
    expect(((await res.json()) as any).error.code).toBe(-32601);
  });

  it("serves an agent card pointing at the A2A endpoint", async () => {
    const { app } = await setup();
    const card = (await get(app, "/.well-known/agent-card.json")).body;
    expect(card.url).toBe("https://swarm.example/a2a");
    expect(card.preferredTransport).toBe("JSONRPC");
  });
});
