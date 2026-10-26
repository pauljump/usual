import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { liveHtml } from "../src/pages.js";

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("links the GitHub button to Usual and reserves a count slot", () => {
  expect(liveHtml("https://thoughtswarm.tryusual.com")).toContain('class="github-link" href="https://github.com/pauljump/usual"');
  expect(liveHtml("https://thoughtswarm.tryusual.com")).toContain('data-github-stars');
});
it("accepts zero stars and caches successful metadata", async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ stargazers_count: 0 }));
  vi.stubGlobal("fetch", request);
  const { githubStars } = await import("../src/github.js");
  expect(((await (await githubStars()).json()) as {stars: number}).stars).toBe(0);
  expect(((await (await githubStars()).json()) as {stars: number}).stars).toBe(0);
  expect(request).toHaveBeenCalledTimes(1);
});
it("does not fabricate a count when GitHub is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
  const { githubStars } = await import("../src/github.js");
  const response = await githubStars();
  expect(response.status).toBe(503);
  expect(((await response.json()) as {stars: number | null}).stars).toBeNull();
});
it("retains the last real count if a later refresh fails", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ stargazers_count: 42 })).mockRejectedValueOnce(new Error("Offline")));
  const { githubStars } = await import("../src/github.js");
  await githubStars();
  now = 3_600_001;
  expect(await (await githubStars()).json()).toMatchObject({ stars: 42, stale: true });
});
