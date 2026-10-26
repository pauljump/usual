// Turns an HTML docs page into readable text with code blocks kept verbatim.
// The content hash is taken over this text, not the raw HTML, so per-request
// noise (CSP nonces, build ids, timestamps in scripts) does not make every
// fetch look like a new version of the page.
//
// parse5 is a spec-compliant HTML parser, so real-world markup (unquoted
// attributes, missing </head>, implied <body>) parses the way browsers do.

import { parse, type DefaultTreeAdapterTypes as T } from "parse5";

type Node = T.ChildNode | T.Document;

const DROP_TAGS = new Set([
  "head", "script", "style", "noscript", "template", "svg", "iframe", "canvas", "nav", "footer",
  "aside", "form", "button", "dialog", "select", "input", "label",
]);
// Navigation chrome that sites mark with ids/classes instead of <nav>.
const CHROME = /(^|[\s_-])(sidebar|side-?nav|sidenav|toc|table-of-contents|breadcrumbs?|menu|navbar|nav|skip-?link|skip-to-content|cookie|banner|feedback|pagination|edit-?page)($|[\s_-])/i;
const BLOCK = new Set([
  "p", "div", "section", "article", "main", "header", "ul", "ol", "dl", "dt", "dd", "table", "tr",
  "blockquote", "figure", "figcaption", "details", "summary", "hr", "br",
]);
const STRUCTURAL = new Set(["html", "body", "main", "article"]);

export interface Extracted {
  title: string;
  text: string;
}

function isElement(n: Node): n is T.Element {
  return "tagName" in n;
}

function attr(el: T.Element, name: string): string | null {
  return el.attrs.find((a) => a.name === name)?.value ?? null;
}

function children(n: Node): T.ChildNode[] {
  return "childNodes" in n ? n.childNodes : [];
}

function walk(n: Node, visit: (el: T.Element) => void): void {
  for (const c of children(n)) {
    if (isElement(c)) {
      visit(c);
      walk(c, visit);
    }
  }
}

function textOf(n: Node): string {
  if (n.nodeName === "#text") return (n as T.TextNode).value;
  if (isElement(n) && (n.tagName === "script" || n.tagName === "style")) return "";
  return children(n).map(textOf).join("");
}

function isChrome(el: T.Element): boolean {
  if (DROP_TAGS.has(el.tagName)) return true;
  const role = attr(el, "role");
  if (role === "navigation" || role === "banner" || role === "contentinfo" || role === "search") return true;
  if (attr(el, "aria-hidden") === "true" || attr(el, "hidden") !== null) return true;
  return CHROME.test(`${attr(el, "id") ?? ""} ${attr(el, "class") ?? ""}`);
}

function render(node: Node, out: string[], isRoot = false): void {
  if (node.nodeName === "#text") {
    out.push((node as T.TextNode).value.replace(/\s+/g, " "));
    return;
  }
  if (!isElement(node)) {
    for (const c of children(node)) render(c, out);
    return;
  }
  const tag = node.tagName;
  if (!isRoot && !STRUCTURAL.has(tag) && isChrome(node)) return;

  if (tag === "pre") {
    const code = children(node).find((c) => isElement(c) && c.tagName === "code") as T.Element | undefined;
    const cls = `${attr(node, "class") ?? ""} ${code ? attr(code, "class") ?? "" : ""} ${attr(node, "data-language") ?? ""}`;
    const lang = cls.match(/(?:language|lang)-([a-z0-9+#-]+)/i)?.[1] ?? "";
    out.push("\n\n```" + lang + "\n" + textOf(node).replace(/^\n+|\s+$/g, "") + "\n```\n\n");
    return;
  }
  if (tag === "code") {
    out.push("`" + textOf(node).replace(/\s+/g, " ") + "`");
    return;
  }
  const heading = tag.match(/^h([1-6])$/);
  if (heading) {
    out.push(`\n\n${"#".repeat(Number(heading[1]))} ${textOf(node).replace(/\s+/g, " ").trim()}\n\n`);
    return;
  }
  if (tag === "li") out.push("\n- ");
  else if (tag === "td" || tag === "th") out.push(" | ");
  else if (BLOCK.has(tag)) out.push("\n");
  for (const c of children(node)) render(c, out);
  if (BLOCK.has(tag) || tag === "li") out.push("\n");
}

const MAIN_MATCHERS: ((el: T.Element) => boolean)[] = [
  (el) => el.tagName === "main",
  (el) => el.tagName === "article",
  (el) => attr(el, "role") === "main",
  (el) => ["main-content", "apicontent", "content", "main"].includes(attr(el, "id") ?? ""),
];

// Use the page's own main landmark when it has one; otherwise score blocks by
// how much paragraph and code text they hold (a light Readability heuristic).
function pickMain(doc: T.Document): Node {
  for (const match of MAIN_MATCHERS) {
    let best: T.Element | null = null;
    let bestLen = 0;
    walk(doc, (el) => {
      if (!match(el)) return;
      const len = textOf(el).trim().length;
      if (len > bestLen) [best, bestLen] = [el, len];
    });
    if (best && bestLen > 200) return best;
  }
  const scores = new Map<T.Element, number>();
  const add = (el: T.Element, n: number) => scores.set(el, (scores.get(el) ?? 0) + n);
  walk(doc, (el) => {
    if (!["p", "pre", "dl", "table", "h2", "h3"].includes(el.tagName)) return;
    const len = textOf(el).trim().length;
    const parent = el.parentNode as Node | null;
    if (!parent || !isElement(parent)) return;
    add(parent, len);
    const grand = parent.parentNode as Node | null;
    if (grand && isElement(grand)) add(grand, len / 2);
  });
  let best: T.Element | null = null;
  let bestScore = 0;
  for (const [el, score] of scores) {
    if (score > bestScore && el.tagName !== "html" && el.tagName !== "body") [best, bestScore] = [el, score];
  }
  if (best && bestScore > 200) return best;
  let body: T.Element | null = null;
  walk(doc, (el) => {
    if (el.tagName === "body" && !body) body = el;
  });
  return body ?? doc;
}

export function extractText(html: string): Extracted {
  const doc = parse(html);
  let title = "";
  walk(doc, (el) => {
    if (el.tagName === "title" && !title) title = textOf(el).replace(/\s+/g, " ").trim();
  });
  const out: string[] = [];
  render(pickMain(doc), out, true);
  const text = out
    .join("")
    .split(/(\n```[\s\S]*?\n```\n)/)
    .map((part, i) =>
      i % 2 === 1 ? part : part.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n- *\n/g, "\n"),
    )
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

// Same estimate the repeat-work measurement used (chars / 4).
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
