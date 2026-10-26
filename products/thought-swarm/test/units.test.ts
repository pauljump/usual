import { describe, expect, it } from "vitest";
import { extractText } from "../src/extract.js";
import { isAllowed, parseRobots } from "../src/robots.js";
import { receiptLine } from "../src/swarm.js";
import { UrlError, assertPublicTarget, firstUrlIn, normalizeUrl } from "../src/url.js";

describe("normalizeUrl", () => {
  it("collapses cosmetic differences onto one key", () => {
    const a = normalizeUrl("https://NextJS.org:443/docs/caching/?utm_source=x&b=2&a=1#section");
    const b = normalizeUrl("https://nextjs.org/docs/caching?a=1&b=2");
    expect(a).toBe(b);
    expect(a).toBe("https://nextjs.org/docs/caching?a=1&b=2");
  });

  it("refuses non-http schemes and embedded credentials", () => {
    expect(() => normalizeUrl("file:///etc/passwd")).toThrow(UrlError);
    expect(() => normalizeUrl("https://user:pw@example.com/")).toThrow(UrlError);
  });
});

describe("assertPublicTarget", () => {
  it.each(["http://localhost/", "http://127.0.0.1/", "http://10.0.0.5/x", "http://192.168.1.1/", "http://169.254.169.254/latest", "http://[::1]/", "http://intranet/"])(
    "blocks %s",
    (u) => expect(() => assertPublicTarget(normalizeUrl(u))).toThrow(UrlError),
  );
  it("allows public hosts", () => expect(() => assertPublicTarget("https://react.dev/learn")).not.toThrow());
});

describe("extractText", () => {
  it("keeps headings and code, drops scripts and navigation", () => {
    const { title, text } = extractText(`<html><head><title>Hooks &amp; you</title><style>a{}</style></head><body>
      <nav>Menu</nav><main><h2>useState</h2><p>Call <code>useState(0)</code> at the top level.</p>
      <pre class="language-js"><code>const [n, setN] = useState(0);
if (n &lt; 3) setN(n + 1);</code></pre>${"<p>filler text here</p>".repeat(20)}</main><script>track()</script></body></html>`);
    expect(title).toBe("Hooks & you");
    expect(text).toContain("## useState");
    expect(text).toContain("`useState(0)`");
    expect(text).toContain("```js\nconst [n, setN] = useState(0);\nif (n < 3) setN(n + 1);\n```");
    expect(text).not.toContain("Menu");
    expect(text).not.toContain("track()");
  });

  it("gives the same text when only scripts change between fetches", () => {
    const page = (nonce: string) => `<html><head><script nonce="${nonce}">x()</script></head><body><main>${"<p>Same docs.</p>".repeat(30)}</main></body></html>`;
    expect(extractText(page("abc")).text).toBe(extractText(page("xyz")).text);
  });
});

describe("robots", () => {
  const rules = parseRobots(`User-agent: *\nDisallow: /private\nAllow: /private/docs\nDisallow: /*.pdf$\n\nUser-agent: OtherBot\nDisallow: /`);
  it("applies longest match", () => {
    expect(isAllowed(rules, "/docs/a")).toBe(true);
    expect(isAllowed(rules, "/private/x")).toBe(false);
    expect(isAllowed(rules, "/private/docs/y")).toBe(true);
    expect(isAllowed(rules, "/files/a.pdf")).toBe(false);
  });
  it("prefers a group naming us", () => {
    const own = parseRobots(`User-agent: *\nDisallow: /\n\nUser-agent: ThoughtSwarm\nAllow: /`);
    expect(isAllowed(own, "/anything")).toBe(true);
  });
});

describe("receiptLine", () => {
  it("states savings on a hit", () => {
    const now = 10_000_000;
    const line = receiptLine(
      { hit: true, first_read_at: now - 58 * 60_000, agents_on_page: 312, reads_on_page: 400, page_tokens: 14820, digest_tokens: 1140, tokens_saved: 13680, tokens_saved_on_page: 4_100_000, page_url: "https://swarm.example/p/nextjs.org" },
      now,
    );
    expect(line).toContain("first read 58 min ago");
    expect(line).toContain("312 agents have read this page");
    expect(line).toContain("13,680 tokens saved for you");
    expect(line).toContain("4.1M saved on this page so far");
  });
});

describe("firstUrlIn", () => {
  it("pulls the URL out of a chat message", () => {
    expect(firstUrlIn("can you read https://react.dev/learn/state, thanks!")).toBe("https://react.dev/learn/state");
    expect(firstUrlIn("hello")).toBeNull();
  });
});

describe("extractText on real-world layouts", () => {
  it("drops sidebars marked by class, keeps a body whose class merely mentions a menu", () => {
    const { text } = extractText(`<html><body class="menu-open"><div id="column2" class="sidebar"><ul><li>Buffer</li><li>Crypto</li></ul></div>
      <div id="apicontent"><h2>SQLite</h2><p>${"The node:sqlite module provides DatabaseSync. ".repeat(10)}</p>
      <pre><code class="language-js"><span>const</span> db = <span>new</span> DatabaseSync(':memory:');</code></pre></div></body></html>`);
    expect(text).toContain("## SQLite");
    expect(text).toContain("```js\nconst db = new DatabaseSync(':memory:');\n```");
    expect(text).not.toContain("Crypto");
  });
});
