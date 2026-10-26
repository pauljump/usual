import { describe, expect, it } from "vitest";
import { pageHtml, setup } from "./helpers.js";

const URL1 = "https://nextjs.org/docs/app/guides/caching";
const admin = { authorization: "Bearer admin-secret", "content-type": "application/json" };

async function readAs(app: Awaited<ReturnType<typeof setup>>["app"], agent: string) {
  const res = await app.handle(new Request(`https://swarm.example/read?url=${encodeURIComponent(URL1)}&agent=${agent}`, { headers: { "x-forwarded-for": "1.1.1.1" } }));
  return (await res.json()) as { receipt: { agents_on_page: number; reads_on_page: number } };
}
async function getJson(app: Awaited<ReturnType<typeof setup>>["app"], path: string, headers: Record<string, string> = {}) {
  const res = await app.handle(new Request(`https://swarm.example${path}`, { headers }));
  return { status: res.status, body: (await res.json()) as any };
}
function mark(app: Awaited<ReturnType<typeof setup>>["app"], body: unknown, headers: Record<string, string> = admin) {
  return app.handle(new Request("https://swarm.example/admin/internal-agents", { method: "POST", headers, body: JSON.stringify(body) }));
}

describe("internal agents", () => {
  async function fourReaders() {
    const ctx = await setup();
    ctx.web.pages.set(URL1, { body: pageHtml("Use revalidateTag.") });
    for (const a of ["tester", "alice", "bob", "carol"]) await readAs(ctx.app, a);
    return ctx;
  }

  it("needs the admin token", async () => {
    const { app } = await fourReaders();
    expect((await mark(app, { agent_ids: ["tester"] }, { "content-type": "application/json" })).status).toBe(401);
    expect((await getJson(app, "/admin/agents")).status).toBe(401);
  });

  it("drops marked agents from stats, the site page, badges and receipts, without deleting reads", async () => {
    const { app, store } = await fourReaders();
    expect((await getJson(app, "/stats")).body.all_time.reads).toBe(4);

    expect((await mark(app, { agent_ids: ["tester"], label: "launch test" })).status).toBe(200);

    const stats = (await getJson(app, "/stats")).body;
    expect(stats.all_time.reads).toBe(3);
    expect(stats.all_time.agents).toBe(3);
    expect(stats.top_pages_24h[0].reads).toBe(3);
    expect((await getJson(app, "/p/nextjs.org")).body.reads).toBe(3);
    const badge = await (await app.handle(new Request("https://swarm.example/badge/nextjs.org.svg"))).text();
    expect(badge).toContain("read by agents: 3");
    expect((await readAs(app, "dave")).receipt.reads_on_page).toBe(4);

    const listed = (await getJson(app, "/admin/agents", admin)).body.agents;
    expect(listed).toHaveLength(5);
    expect(listed.filter((a: { internal: boolean }) => a.internal)).toHaveLength(1);
    expect(listed.find((a: { internal: boolean }) => a.internal).label).toBe("launch test");
    // The raw history is untouched.
    const all = await (store as any).db.first("SELECT COUNT(*) AS n FROM reads");
    expect(all.n).toBe(5);
  });

  it("hides a page from public lists when only internal agents make up its three readers", async () => {
    const { app } = await fourReaders();
    await mark(app, { agent_ids: ["tester", "alice"], label: "tests" });
    expect((await getJson(app, "/stats")).body.top_pages_24h).toHaveLength(0);
  });

  it("can be undone, and accepts stored hashes as well as raw ids", async () => {
    const { app, swarm } = await fourReaders();
    const hash = await swarm.hashAgent("tester");
    await mark(app, { agents: [hash], label: "tests" });
    expect((await getJson(app, "/stats")).body.all_time.reads).toBe(3);
    await mark(app, { agents: [hash], internal: false });
    expect((await getJson(app, "/stats")).body.all_time.reads).toBe(4);
    expect((await mark(app, { agents: [] })).status).toBe(400);
  });
});
