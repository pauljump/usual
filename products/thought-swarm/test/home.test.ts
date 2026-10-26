import { expect, it } from "vitest";
import { setup } from "./helpers.js";

async function seedLibrary(store: unknown) {
  const db = (store as { db: { run(sql: string, p: unknown[]): Promise<void> } }).db;
  const add = (url: string, collection: string, status: string) =>
    db.run("INSERT INTO library (url, collection, status, detail, checked_at) VALUES (?, ?, ?, ?, ?)", [url, collection, status, "", 1]);
  await add("https://developer.apple.com/app-store/review/guidelines", "Apple submission pack", "ready");
  await add("https://docs.fastlane.tools/actions/upload_to_testflight", "Apple submission pack", "ready");
  await add("https://developer.apple.com/system-status", "Apple submission pack", "unavailable");
  await add("https://www.sec.gov/filing.htm", "Anthropic S-1", "ready");
}

it("leads the home page with the library and its collections, with activity below", async () => {
  const { app, store } = await setup();
  await seedLibrary(store);
  const page = await (await app.handle(new Request("https://swarm.example/", { headers: { accept: "text/html" } }))).text();
  expect(page).toContain("THE LIBRARY");
  expect(page).toMatch(/<div class="big">3<\/div>/);
  expect(page).toContain('href="/library?collection=Apple%20submission%20pack"');
  expect(page).toMatch(/Apple submission pack<\/a><span class="dots" aria-hidden="true"><\/span><small>2 ready/);
  expect(page).toContain('href="/library?source=developer.apple.com"');
  expect(page.indexOf('id="library"')).toBeLessThan(page.indexOf('id="reading"'));
  expect(page.indexOf("THE LIBRARY")).toBeLessThan(page.indexOf('id="saved"'));
});

it("filters the library by collection", async () => {
  const { app, store } = await setup();
  await seedLibrary(store);
  const res = await app.handle(new Request("https://swarm.example/library?collection=Anthropic%20S-1"));
  const body = (await res.json()) as { total: number; collection: string; entries: { url: string }[] };
  expect(body.collection).toBe("Anthropic S-1");
  expect(body.total).toBe(1);
  expect(body.entries[0].url).toBe("https://www.sec.gov/filing.htm");
  const html = await (await app.handle(new Request("https://swarm.example/library?collection=Anthropic%20S-1", { headers: { accept: "text/html" } }))).text();
  expect(html).toContain('name="collection" value="Anthropic S-1"');
});
