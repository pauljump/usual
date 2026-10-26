import { describe, expect, it } from "vitest";
import { outline, section } from "../src/sections.js";
import { pageHtml, setup } from "./helpers.js";

const GUIDELINES = [
  "# App Review Guidelines",
  "### Introduction",
  "Intro text.",
  "### 4. Design",
  "Design intro.",
  "- 4.1 Copycats",
  "Come up with your own ideas.",
  "- 4.2 Minimum Functionality",
  "Apps should be more than a website.",
  "- 4.2.1 Apps using ARKit should provide rich experiences.",
  "- 4.3 Spam",
  "",
  "- (a) Don't create multiple Bundle IDs of the same app.",
  "",
  "- (b) Don't submit apps that are indistinguishable from what's already widely available.",
  "- 4.4 Extensions",
  "Extensions must follow the rules.",
  "### 5. Legal",
  "- 5.1 Privacy",
  "Ask before collecting data.",
].join("\n");

describe("page outline", () => {
  it("lists headings and numbered rules, nesting rules under their heading", () => {
    const o = outline(GUIDELINES);
    expect(o).toContain("- 4.3 Spam");
    expect(o).toContain("- 4.2.1 Apps using ARKit");
    expect(o.indexOf("4. Design")).toBeLessThan(o.indexOf("4.1 Copycats"));
  });

  it("is empty for pages with little structure, and ignores ordinary numbered lists and code", () => {
    expect(outline("# Title\nSome text.\n1. Install\n2. Run")).toBe("");
    expect(outline("# A\n## B\n## C\n```\n# not a heading\n```\n## D")).not.toContain("not a heading");
  });

  it("stays within its budget on huge pages", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `## Heading number ${i} with a fairly long title for padding`).join("\n");
    expect(outline(big).length).toBeLessThan(4_100);
  });
});

describe("section lookup", () => {
  it("returns a numbered rule verbatim, including its sub-rules, and stops at the next sibling", () => {
    const s = section(GUIDELINES, "4.3");
    expect(s.found).toBe(true);
    expect(s.text).toContain("multiple Bundle IDs");
    expect(s.text).toContain("indistinguishable");
    expect(s.text).not.toContain("4.4 Extensions");
    expect(section(GUIDELINES, "4.2").text).toContain("4.2.1 Apps using ARKit");
    expect(section(GUIDELINES, "Guideline 4.3.").text).toContain("4.3 Spam");
  });

  it("finds headings by name and runs to the next heading of the same level", () => {
    const s = section(GUIDELINES, "design");
    expect(s.text).toContain("4.3 Spam");
    expect(s.text).not.toContain("5.1 Privacy");
  });

  it("falls back to paragraphs that mention the term", () => {
    const s = section(GUIDELINES, "website");
    expect(s.found).toBe(true);
    expect(s.text).toContain("more than a website");
    expect(section(GUIDELINES, "blockchain").found).toBe(false);
  });
});

describe("reading a section through the swarm", () => {
  const URL1 = "https://docs.example.dev/review/guidelines";
  const html = pageHtml(
    "<h3>4. Design</h3><ul><li>4.1 Copycats. Be original.</li><li>4.2 Minimum Functionality. More than a website.</li><li>4.3 Spam. Don't create multiple Bundle IDs of the same app.</li><li>4.4 Extensions. Follow the rules.</li></ul>",
  );

  it("adds the outline and the requested section, and counts only the tokens actually saved", async () => {
    const { app, web, digester } = await setup();
    web.pages.set(URL1, { body: html });
    const read = async (ip: string, q = "") => {
      const res = await app.handle(new Request(`https://swarm.example/read?url=${encodeURIComponent(URL1)}${q}`, { headers: { "x-forwarded-for": ip } }));
      return (await res.json()) as any;
    };
    await read("1.1.1.1");
    const plain = await read("2.2.2.2");
    expect(plain.markdown).toContain("## Sections on this page");
    expect(plain.markdown).toContain("4.3 Spam");

    const withSection = await read("3.3.3.3", "&section=4.3");
    expect(withSection.section.found).toBe(true);
    expect(withSection.markdown).toContain("multiple Bundle IDs");
    expect(withSection.receipt.digest_tokens).toBeGreaterThan(plain.receipt.digest_tokens);
    expect(withSection.receipt.tokens_saved).toBe(Math.max(0, withSection.receipt.page_tokens - withSection.receipt.digest_tokens));
    expect(digester.calls).toBe(1);
  });
});
