import { describe, expect, it } from "vitest";
import { checkUrl, fetchedUrls, listedUrls } from "../src/contribute.js";
import { setup, pageHtml } from "./helpers.js";

describe("checkUrl", () => {
  it.each([
    "https://developer.apple.com/app-store/review/guidelines/#4.3",
    "https://docs.expo.dev/build/setup/",
    "https://www.nysenate.gov/legislation/laws/JUD/478",
  ])("keeps public docs: %s", (u) => expect(checkUrl(u).ok).toBe(true));

  it.each([
    ["https://stackoverflow.com/questions/1", "excluded site"],
    ["https://old.reddit.com/r/iOSProgramming", "excluded site"],
    ["https://developer.apple.com/forums/thread/123", "excluded site"],
    ["https://docs.google.com/spreadsheets/d/abc/export", "excluded site"],
    ["https://bucket.s3.amazonaws.com/f.pdf?X-Amz-Signature=abc", "looks like it carries a secret"],
    ["https://api.example.com/v1/data?api_key=abc", "looks like it carries a secret"],
    ["https://example.com/reset/aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z", "looks like a private link"],
    ["http://localhost:3000/", "not a public page"],
    ["https://203.0.113.5/docs", "IP address or custom port"],
    ["not a url", "not a URL"],
  ])("drops %s", (u, reason) => expect(checkUrl(u)).toEqual({ ok: false, reason }));

  it("drops the contributor's own sites, subdomains included", () => {
    expect(checkUrl("https://app.mysite.com/x", ["mysite.com"]).ok).toBe(false);
    expect(checkUrl("https://notmysite.com/x", ["mysite.com"]).ok).toBe(true);
  });

  it("normalizes so duplicates collapse", () => {
    expect(checkUrl("https://Expo.dev/docs/?utm_source=x#top")).toEqual({ ok: true, url: "https://expo.dev/docs" });
  });
});

describe("fetchedUrls", () => {
  it("reads WebFetch calls from a Claude Code transcript line and nothing else", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [
      { type: "text", text: "see https://example.com/not-fetched" },
      { type: "tool_use", name: "WebFetch", input: { url: "https://docs.expo.dev/eas", prompt: "x" } },
      { type: "tool_use", name: "WebSearch", input: { query: "expo eas" } },
    ] } });
    expect(fetchedUrls(line)).toEqual(["https://docs.expo.dev/eas"]);
    expect(fetchedUrls("{broken")).toEqual([]);
  });

  it("reads plain lists", () => {
    expect(listedUrls("# mine\nhttps://a.dev/x  note\n\nhttps://b.dev\n")).toEqual(["https://a.dev/x", "https://b.dev"]);
  });
});

describe("contribute=1", () => {
  const URL1 = "https://docs.example.com/caching";
  it("digests the page without counting a read, under the normal hourly limit", async () => {
    const { app, web, store, digester } = await setup({ missesPerHour: 1 });
    web.pages.set(URL1, { body: pageHtml("Contributed.") });
    web.pages.set(URL1 + "-2", { body: pageHtml("Second.") });
    const give = (u: string) => app.handle(new Request(`https://swarm.example/read?contribute=1&url=${encodeURIComponent(u)}`));
    expect((await give(URL1)).status).toBe(200);
    expect((await store.totals()).reads).toBe(0);
    expect((await give(URL1 + "-2")).status).toBe(429);
    const first: any = await (await app.handle(new Request(`https://swarm.example/read?agent=a&url=${encodeURIComponent(URL1)}`))).json();
    expect(first.receipt.hit).toBe(true);
    expect(digester.calls).toBe(1);
  });
});
