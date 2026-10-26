// Offline stand-in for the model, for local development without an Anthropic
// key. Everything else (fetching, hashing, storage, receipts) is real. Its
// output is labelled in the title, summary and gotchas, and its recipe is
// distinct, so an offline digest can never be mistaken for or served as a
// real one.

import type { Digest, Digester } from "./digest.js";

export const OFFLINE_RECIPE = "offline-v1";
export const OFFLINE_LABEL = "OFFLINE PLACEHOLDER: no model was called. This is not a real digest; set ANTHROPIC_API_KEY to generate one.";

export class OfflineDigester implements Digester {
  readonly recipe = OFFLINE_RECIPE;

  async digest(page: { url: string; title: string; text: string }): Promise<Digest> {
    const firstCode = page.text.match(/```(\w*)\n([\s\S]*?)\n```/);
    const firstParagraph = page.text.split("\n").find((l) => l.length > 80)?.slice(0, 300) ?? "";
    return {
      title: `[offline] ${page.title || page.url}`,
      summary: `${OFFLINE_LABEL}${firstParagraph ? ` First paragraph of the page: ${firstParagraph}` : ""}`,
      key_points: [...page.text.matchAll(/^#{2,3} (.+)$/gm)].slice(0, 8).map((m) => `Heading on the page: ${m[1]}`),
      api: [],
      code_examples: firstCode ? [{ caption: "First example on the page", language: firstCode[1], code: firstCode[2] }] : [],
      gotchas: [OFFLINE_LABEL],
      version_info: "",
    };
  }
}
