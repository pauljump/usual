import type { Digest, Digester } from "../src/digest.js";
import { PageFetcher, type FetchFn } from "../src/fetcher.js";
import { App } from "../src/http.js";
import { sqliteDb } from "../src/sqlite.js";
import { SwarmStore } from "../src/store.js";
import { Swarm } from "../src/swarm.js";

export function pageHtml(body: string, title = "Caching guide"): string {
  return `<!doctype html><html><head><title>${title}</title><script>var nonce="${Math.random()}"</script></head>
<body><nav>Home Docs Blog</nav><main><h1>${title}</h1><p>${body}</p>
<pre><code class="language-ts">revalidateTag('products')</code></pre>
<p>${"Long explanation of caching behaviour. ".repeat(80)}</p></main><footer>© Example</footer></body></html>`;
}

export class FakeWeb {
  pages = new Map<string, { status?: number; type?: string; body: string }>();
  robots = new Map<string, string>();
  requests: string[] = [];
  fetch: FetchFn = async (input) => {
    this.requests.push(input);
    const url = new URL(input);
    if (url.pathname === "/robots.txt") {
      const r = this.robots.get(url.origin);
      return r === undefined ? new Response("", { status: 404 }) : new Response(r, { headers: { "content-type": "text/plain" } });
    }
    const p = this.pages.get(input);
    if (!p) return new Response("nope", { status: 404 });
    const res = new Response(p.body, { status: p.status ?? 200, headers: { "content-type": p.type ?? "text/html; charset=utf-8" } });
    Object.defineProperty(res, "url", { value: input });
    return res;
  };
}

export class FakeDigester implements Digester {
  readonly recipe = "digest-v1/fake";
  calls = 0;
  delayMs = 0;
  async digest(page: { url: string; title: string; text: string }): Promise<Digest> {
    this.calls += 1;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    return {
      title: page.title,
      summary: `Digest of ${page.url}`,
      key_points: [page.text.slice(0, 40)],
      api: [{ name: "revalidateTag", signature: "revalidateTag(tag: string)", notes: "Purges cached data for a tag." }],
      code_examples: [{ caption: "Revalidate", language: "ts", code: "revalidateTag('products')" }],
      gotchas: [],
      version_info: "",
    };
  }
}

export async function setup(opts: { missesPerHour?: number; now?: () => number } = {}) {
  const web = new FakeWeb();
  const digester = new FakeDigester();
  const store = new SwarmStore(await sqliteDb(":memory:"));
  await store.init();
  const events: unknown[] = [];
  const swarm = new Swarm({
    store,
    fetcher: new PageFetcher(web.fetch),
    digester,
    publicBaseUrl: "https://swarm.example",
    agentSalt: "test",
    now: opts.now,
    onRead: (e) => {
      events.push(e);
    },
  });
  const app = new App({ swarm, store, publicBaseUrl: "https://swarm.example", missesPerHour: opts.missesPerHour, a2aBearerToken: undefined });
  return { web, digester, store, swarm, app, events };
}
