import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ClaudeDigester, DigestError, renderDigest, type Digest } from "../src/digest.js";

const sample: Digest = {
  title: "Caching in Next.js",
  summary: "How data and route caching work.",
  key_points: ["fetch results are cached per tag"],
  api: [{ name: "revalidateTag", signature: "revalidateTag(tag: string): void", notes: "Purges a tag." }],
  code_examples: [{ caption: "Tag a fetch", language: "ts", code: "fetch(url, { next: { tags: ['products'] } })" }],
  gotchas: ["Only works in server code."],
  version_info: "Next.js 16",
};

function fakeClient(reply: { stop_reason: string; text: string }, seen: { url?: string; headers?: Headers; body?: any }) {
  return new Anthropic({
    apiKey: "test",
    maxRetries: 0,
    fetch: async (url: any, init: any) => {
      seen.url = String(url);
      seen.headers = new Headers(init.headers);
      seen.body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          id: "msg_1", type: "message", role: "assistant", model: seen.body.model,
          content: [{ type: "text", text: reply.text }],
          stop_reason: reply.stop_reason, stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
}

describe("ClaudeDigester", () => {
  it("defaults to Haiku 5.5, which has no server-side fallback", async () => {
    const seen: any = {};
    const d = new ClaudeDigester(fakeClient({ stop_reason: "end_turn", text: JSON.stringify(sample) }, seen));
    await d.digest({ url: "u", title: "", text: "t" });
    expect(seen.body.model).toBe("claude-haiku-5-5");
    expect(seen.body).not.toHaveProperty("fallbacks");
    expect(d.recipe).toBe("digest-v1/claude-haiku-5-5");
  });

  it("sends a structured-output request with server-side fallbacks on Opus and parses the digest", async () => {
    const seen: any = {};
    const d = new ClaudeDigester(fakeClient({ stop_reason: "end_turn", text: JSON.stringify(sample) }, seen), "claude-opus-5-5");
    const out = await d.digest({ url: "https://nextjs.org/docs/caching", title: "Caching", text: "page text" });
    expect(out).toEqual(sample);
    expect(seen.body.model).toBe("claude-opus-5-5");
    expect(seen.body.fallbacks).toBe("default");
    expect(seen.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(seen.body.output_config.format.type).toBe("json_schema");
    expect(seen.body.output_config.format.schema.required).toContain("code_examples");
    expect(seen.body).not.toHaveProperty("thinking");
    expect(seen.body.messages[0].content).toContain('<page url="https://nextjs.org/docs/caching"');
    expect(d.recipe).toBe("digest-v1/claude-opus-5-5");
  });

  it("surfaces refusals and malformed output as digest errors", async () => {
    const refused = new ClaudeDigester(fakeClient({ stop_reason: "refusal", text: "" }, {}));
    await expect(refused.digest({ url: "u", title: "", text: "t" })).rejects.toBeInstanceOf(DigestError);
    const garbled = new ClaudeDigester(fakeClient({ stop_reason: "end_turn", text: "{not json" }, {}));
    await expect(garbled.digest({ url: "u", title: "", text: "t" })).rejects.toThrow("expected format");
  });

  it("refuses pages too long to digest instead of cutting them", async () => {
    const d = new ClaudeDigester(fakeClient({ stop_reason: "end_turn", text: "{}" }, {}));
    await expect(d.digest({ url: "u", title: "", text: "x".repeat(400_001) })).rejects.toMatchObject({ status: 413 });
  });
});

describe("renderDigest", () => {
  it("keeps signatures and code verbatim", () => {
    const md = renderDigest(sample, "https://nextjs.org/docs/caching");
    expect(md).toContain("`revalidateTag(tag: string): void`: Purges a tag.");
    expect(md).toContain("```ts\nfetch(url, { next: { tags: ['products'] } })\n```");
    expect(md).toContain("Version: Next.js 16");
    expect(md.endsWith("Source: https://nextjs.org/docs/caching")).toBe(true);
  });
});
