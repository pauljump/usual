import { describe, expect, it } from "vitest";
import { PageFetcher, MAX_PAGE_BYTES } from "../src/fetcher.js";
import { extractText } from "../src/extract.js";
import { outline, section } from "../src/sections.js";
import { setup } from "./helpers.js";

const url = "https://www.sec.gov/Archives/edgar/data/2130357/000162828026067168/anthropicpbc-sx1.htm";
const filing = `<html><head><title>Example S-1</title></head><body><document>
<div><div><span>PROSPECTUS SUMMARY</span></div><p>First page disclosure.</p></div>
<div><div><span>RISK FACTORS</span></div><p>${"Material risks. ".repeat(100)}</p></div>
<div><div><span>FINANCIAL STATEMENTS</span></div><table>
<tr><td>USD millions</td><td>2025</td><td>2026</td></tr>
${"<tr><td>Revenue</td><td>100</td><td>200</td></tr>".repeat(100)}
</table></div><div><div><span>NOTES TO FINANCIAL STATEMENTS</span></div>
<p>Final page disclosure about commitments.</p></div></document></body></html>`;

describe("large documents", () => {
  it("preserves sibling filing pages, table labels, and section lookups", () => {
    const { text } = extractText(filing, { wholeDocument: true });
    expect(text).toContain("First page disclosure.");
    expect(text).toContain("Final page disclosure about commitments.");
    expect(text).toContain("USD millions | 2025 | 2026");
    expect(text).toContain("Revenue | 100 | 200");
    expect(outline(text)).toContain("NOTES TO FINANCIAL STATEMENTS");
    expect(section(text, "RISK FACTORS").text).toContain("Material risks.");
    expect(section(text, "RISK FACTORS").text).not.toContain("Revenue");
  });

  it("reads a 14 MB filing, caches the digest, and exposes its final section", async () => {
    const { swarm, web, digester } = await setup();
    // SEC filings contain much more markup than readable text.
    const html = filing.replace("<head>", `<head><style>${" ".repeat(14_000_000)}</style>`);
    web.pages.set(url, { body: html });
    const fetched = await new PageFetcher(web.fetch).fetchPage(url);
    expect(fetched.text).toContain("First page disclosure.");
    expect(fetched.text).toContain("Final page disclosure about commitments.");
    expect((await swarm.read(url, "a")).receipt.hit).toBe(false);
    const cached = await swarm.read(url, "b", { section: "NOTES TO FINANCIAL STATEMENTS" });
    expect(cached.receipt.hit).toBe(true);
    expect(cached.section?.text).toContain("Final page disclosure");
    expect(digester.calls).toBe(1);
  });

  it("cancels an oversized stream even without a Content-Length header", async () => {
    let cancelled = false;
    const fetcher = new PageFetcher(async input => {
      if (input.endsWith("robots.txt")) return new Response("", { status: 404 });
      return new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(1_000_000)); },
        cancel() { cancelled = true; },
      }), { headers: { "content-type": "text/html" } });
    });
    await expect(fetcher.fetchPage(url)).rejects.toThrow(`${MAX_PAGE_BYTES.toLocaleString("en-US")} byte`);
    expect(cancelled).toBe(true);
  });

  it("does not cache or record a read when large-document processing fails", async () => {
    const { swarm, web, digester, events } = await setup();
    web.pages.set(url, { body: filing });
    const original = digester.digest.bind(digester);
    digester.digest = async () => { throw new Error("part failed"); };
    await expect(swarm.read(url, "a")).rejects.toThrow("part failed");
    expect(events).toHaveLength(0);
    digester.digest = original;
    expect((await swarm.read(url, "a")).receipt.hit).toBe(false);
  });
});
