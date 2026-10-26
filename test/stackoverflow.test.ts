import { describe, expect, it } from "vitest";
import { PageFetcher } from "../src/fetcher.js";
import { stackExchangeUrls, stackOverflowQuestionId } from "../src/stackoverflow.js";
import { FakeWeb, setup } from "./helpers.js";

const question = {
  items: [
    {
      question_id: 123,
      title: "TestFlight build stuck in &quot;Processing&quot;",
      body: "<p>My build has been processing for hours after upload.</p><pre><code>xcodebuild -exportArchive</code></pre>",
      score: 42,
      tags: ["ios", "testflight"],
      owner: { display_name: "asker" },
      link: "https://stackoverflow.com/questions/123/testflight-build-stuck",
      content_license: "CC BY-SA 4.0",
    },
  ],
};
const answers = {
  items: [
    { answer_id: 2, score: 90, is_accepted: false, owner: { display_name: "top" }, body: `<p>${"Check the export compliance setting. ".repeat(3)}</p>` },
    { answer_id: 1, score: 10, is_accepted: true, owner: { display_name: "fixer" }, body: "<p>Set ITSAppUsesNonExemptEncryption in Info.plist.</p>" },
  ],
};

function web(q: unknown = question, a: unknown = answers) {
  const w = new FakeWeb();
  const urls = stackExchangeUrls("123");
  w.pages.set(urls.question, { type: "application/json", body: JSON.stringify(q) });
  w.pages.set(urls.answers, { type: "application/json", body: JSON.stringify(a) });
  return w;
}

describe("Stack Overflow", () => {
  it("recognizes question URLs only", () => {
    expect(stackOverflowQuestionId("https://stackoverflow.com/questions/123/some-title")).toBe("123");
    expect(stackOverflowQuestionId("https://stackoverflow.com/q/123")).toBe("123");
    expect(stackOverflowQuestionId("https://stackoverflow.com/tags/ios")).toBeNull();
    expect(stackOverflowQuestionId("https://example.com/questions/123")).toBeNull();
  });

  it("reads the question and answers through the API, accepted answer first, with attribution", async () => {
    const page = await new PageFetcher(web().fetch).fetchPage("https://stackoverflow.com/questions/123/testflight-build-stuck");
    expect(page.title).toBe('TestFlight build stuck in "Processing"');
    expect(page.text).toContain("```\nxcodebuild -exportArchive\n```");
    expect(page.text.indexOf("Accepted answer by fixer")).toBeLessThan(page.text.indexOf("Answer by top"));
    expect(page.attribution).toBe(
      '"TestFlight build stuck in "Processing"" on Stack Overflow, asked by asker, answers by fixer, top. Licensed CC BY-SA 4.0: https://stackoverflow.com/questions/123/testflight-build-stuck',
    );
  });

  it("reports a missing question and API throttling clearly", async () => {
    await expect(new PageFetcher(web({ items: [] }).fetch).fetchPage("https://stackoverflow.com/questions/123")).rejects.toMatchObject({ status: 404 });
    await expect(
      new PageFetcher(web({ error_id: 502, error_name: "throttle_violation", error_message: "too many requests" }).fetch).fetchPage("https://stackoverflow.com/questions/123"),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("puts the attribution in every digest served from the cache", async () => {
    const { swarm, web: w } = await setup();
    const so = web();
    for (const [k, v] of so.pages) w.pages.set(k, v);
    await swarm.read("https://stackoverflow.com/questions/123", "agent-a");
    const hit = await swarm.read("https://stackoverflow.com/questions/123", "agent-b");
    expect(hit.markdown).toContain("Source: \"TestFlight build stuck");
    expect(hit.markdown).toContain("Licensed CC BY-SA 4.0");
  });
});
