import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

it("streams a large multi-page filing in the actual Worker runtime", async () => {
  const bundle = await build({
    stdin: { contents: `import { streamFiling } from './src/filing.ts';
      export default { async fetch(req) { return Response.json(await streamFiling(new Response(req.body))); } };`,
      resolveDir: process.cwd(), sourcefile: "filing-test.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "browser",
  });
  const worker = new Miniflare({ workers: [{ config: { name: "filing-test", compatibilityDate: "2026-10-01", manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } } } }] });
  try {
    const html = `<html><head><style>${"x".repeat(10_000_000)}</style></head><body>
      <div><span>RISK FACTORS</span></div><p>First &amp; foremost.</p>
      <div hidden>HIDDEN MACHINE DATA</div><script>SECRET SCRIPT</script><!-- COMMENT -->
      <div><span>FINANCIAL STATEMENTS</span></div><table><tr><td>USD millions</td><td>2025</td><td>2026</td></tr>
      ${"<tr><td>Revenue</td><td>100</td><td>200</td></tr>".repeat(80_000)}</table>
      <div><span>FINAL FOOTNOTES</span></div><p>Last disclosure.</p></body></html>`;
    const response = await worker.dispatchFetch("http://localhost", { method: "POST", body: html });
    expect(response.status).toBe(200);
    const { text } = await response.json() as { text: string };
    expect(text).toContain("## RISK FACTORS");
    expect(text).toContain("First & foremost.");
    expect(text).toContain("USD millions | 2025 | 2026");
    expect(text.match(/Revenue \| 100 \| 200/g)).toHaveLength(80_000);
    expect(text).toContain("Last disclosure.");
    expect(text).not.toMatch(/HIDDEN MACHINE DATA|SECRET SCRIPT|COMMENT/);
  } finally {
    await worker.dispose();
  }
}, 30_000);
