import { describe, expect, it } from "vitest";
import { RECIPE_VERSION, renderDigest } from "../src/digest.js";
import { OFFLINE_LABEL, OFFLINE_RECIPE, OfflineDigester } from "../src/offline.js";

describe("offline digester", () => {
  it("labels every digest so it can't pass for a real one", async () => {
    const d = await new OfflineDigester().digest({ url: "https://example.com/docs", title: "Docs", text: "## Install\n" + "Some long paragraph about installing the thing. ".repeat(4) });
    expect(d.title).toBe("[offline] Docs");
    expect(d.summary.startsWith(OFFLINE_LABEL)).toBe(true);
    expect(d.gotchas).toContain(OFFLINE_LABEL);
    expect(renderDigest(d, "https://example.com/docs")).toContain("OFFLINE PLACEHOLDER");
  });

  it("uses its own recipe, so offline digests never share a cache key with real ones", () => {
    expect(new OfflineDigester().recipe).toBe(OFFLINE_RECIPE);
    expect(OFFLINE_RECIPE.startsWith(RECIPE_VERSION)).toBe(false);
  });
});
