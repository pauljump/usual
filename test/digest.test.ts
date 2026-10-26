import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { ClaudeDigester, DigestError, renderDigest, type Digest, splitDocument, MAX_DOCUMENT_CHARS, MAX_INPUT_CHARS } from "../src/digest.js";

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
      (seen as any).bodies ??= [];
      (seen as any).bodies.push(seen.body);
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
    expect(d.recipe).toBe("digest-v3/claude-haiku-5-5");
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
    expect(d.recipe).toBe("digest-v3/claude-opus-5-5");
  });

  it("surfaces refusals and malformed output as digest errors", async () => {
    const refused = new ClaudeDigester(fakeClient({ stop_reason: "refusal", text: "" }, {}));
    await expect(refused.digest({ url: "u", title: "", text: "t" })).rejects.toBeInstanceOf(DigestError);
    const garbled = new ClaudeDigester(fakeClient({ stop_reason: "end_turn", text: "{not json" }, {}));
    await expect(garbled.digest({ url: "u", title: "", text: "t" })).rejects.toThrow("expected format");
  });

  it("covers every part before synthesizing a large document", async () => {
    const seen: any = {};
    const d = new ClaudeDigester(fakeClient({ stop_reason: "end_turn", text: JSON.stringify(sample) }, seen));
    const text = "OPENING\n\n" + "Financial disclosure. ".repeat(40_000) + "\n\nFINAL FOOTNOTE";
    const parts = splitDocument(text);
    const result = await d.digest({ url: "https://www.sec.gov/filing", title: "S-1", text });
    expect(seen.bodies).toHaveLength(parts.length + 1);
    for (let i = 0; i < parts.length; i++) {
      expect(seen.bodies[i].messages[0].content).toContain(parts[i]);
      expect(seen.bodies[i].max_tokens).toBe(8000);
    }
    expect(seen.bodies.at(-2).messages[0].content).toContain("FINAL FOOTNOTE");
    expect(seen.bodies.at(-1).messages[0].content).toContain("summaries of ALL parts");
    expect(result.gotchas.at(-1)).toContain(`${parts.length} part summaries`);
  });

  it("aborts without synthesis if any part fails validation", async () => {
    const seen: any = {};
    const d = new ClaudeDigester(fakeClient({ stop_reason: "max_tokens", text: JSON.stringify(sample) }, seen));
    await expect(d.digest({ url: "u", title: "", text: "x".repeat(800_001) })).rejects.toThrow("too long");
    expect(seen.bodies).toHaveLength(1);
  });

  it("refuses pages too long to digest instead of cutting them", async () => {
    const d = new ClaudeDigester(fakeClient({ stop_reason: "end_turn", text: "{}" }, {}));
    await expect(d.digest({ url: "u", title: "", text: "x".repeat(MAX_DOCUMENT_CHARS + 1) })).rejects.toMatchObject({ status: 413 });
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


describe("splitDocument", () => {
  it.each([
    "paragraph\n\n".repeat(90_000),
    "row | value\n".repeat(90_000),
    "x".repeat(399_999) + "😀" + "z".repeat(400_000),
  ])("preserves every character with bounded chunks", (text) => {
    const parts = splitDocument(text);
    expect(parts.join("")).toBe(text);
    expect(parts.every(p => p.length <= MAX_INPUT_CHARS)).toBe(true);
    expect(parts.some(p => /[\uD800-\uDBFF]$/.test(p))).toBe(false);
  });
});
