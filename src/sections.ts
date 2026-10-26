// Deterministic structure of a page's extracted text: an outline of its
// headings and numbered rules, and verbatim lookup of one section. A short
// digest can't keep every rule of a long reference page (Apple's App Review
// Guidelines run to ~24k tokens), so the outline tells the agent what exists
// and a section lookup returns exactly that part, from the live page.

const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
// "- 4.3 Spam", "4.3 Spam", "- 4.3. Spam", "- 1.4.3 Apps that …"
const NUMBERED = /^(?:[-*]\s+)?(\d+(?:\.\d+)*)\.?\s+(\S.*)$/;

const OUTLINE_MAX_ENTRIES = 200;
const OUTLINE_MAX_CHARS = 4_000; // ~1k tokens on top of the digest
const OUTLINE_TITLE_CHARS = 70;
const SECTION_MAX_CHARS = 16_000; // ~4k tokens

interface Mark {
  line: number;
  kind: "heading" | "rule";
  depth: number; // heading level, or number of parts in a rule number
  id?: string; // rule number
  title: string;
}

function marks(lines: string[]): Mark[] {
  const out: Mark[] = [];
  let inCode = false;
  lines.forEach((raw, line) => {
    const l = raw.trim();
    if (l.startsWith("```")) inCode = !inCode;
    if (inCode) return;
    const h = HEADING.exec(l);
    if (h) {
      out.push({ line, kind: "heading", depth: h[1].length, title: h[2] });
      return;
    }
    const n = NUMBERED.exec(l);
    // A rule number has at least one dot ("4.3"), so ordinary numbered lists
    // ("1. Install") don't count as structure.
    if (n && n[1].includes(".")) out.push({ line, kind: "rule", depth: n[1].split(".").length, id: n[1], title: n[2] });
  });
  return out;
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** Markdown outline of the page, or "" when the page has too little structure to be worth one. */
export function outline(text: string): string {
  const ms = marks(text.split("\n"));
  if (ms.length < 4) return "";
  const minHeading = Math.min(...ms.filter((m) => m.kind === "heading").map((m) => m.depth), 6);
  const render = (keep: Mark[]) => {
    let headingIndent = -1;
    const lines = keep.map((m) => {
      let indent: number;
      if (m.kind === "heading") indent = headingIndent = m.depth - minHeading;
      else indent = headingIndent + m.depth - 1; // 4.3 sits one level under "4. Design"
      const label = m.kind === "rule" ? `${m.id} ${clip(m.title, OUTLINE_TITLE_CHARS)}` : clip(m.title, OUTLINE_TITLE_CHARS);
      return `${"  ".repeat(Math.max(0, indent))}- ${label}`;
    });
    // Cut to the budget; a section lookup still reaches anything left out.
    let out = "";
    let n = 0;
    for (const l of lines) {
      if (n >= OUTLINE_MAX_ENTRIES || out.length + l.length + 1 > OUTLINE_MAX_CHARS) break;
      out += (n ? "\n" : "") + l;
      n++;
    }
    if (n < lines.length) out += `\n- … ${lines.length - n} more`;
    return { out, shown: n, total: lines.length };
  };
  // Long pages: drop the deepest rules (4.3.1), then the deepest headings,
  // but stop pruning before the outline gets too sparse to be useful.
  const levels: Mark[][] = [ms];
  for (let d = 3; d >= 1; d--) levels.push(ms.filter((m) => m.kind === "heading" || m.depth <= d));
  const headingsOnly = ms.filter((m) => m.kind === "heading");
  for (let h = 5; h > minHeading; h--) levels.push(headingsOnly.filter((m) => m.depth <= h));
  let best = render(ms);
  for (const keep of levels) {
    const r = render(keep);
    if (r.total < 25 && best.total >= 25) break;
    best = r;
    if (r.shown === r.total) break;
  }
  return best.out;
}

export interface SectionResult {
  query: string;
  found: boolean;
  text: string; // verbatim page text, possibly several matches
  truncated: boolean;
}

/**
 * Verbatim text of the part of the page matching `query`: a rule number ("4.3"),
 * a heading, or failing those, the paragraphs that mention it.
 */
export function section(text: string, query: string): SectionResult {
  const q = query.trim().replace(/^(?:§|guideline|rule|section)\s*/i, "").replace(/\.$/, "");
  const lines = text.split("\n");
  const ms = marks(lines);
  const spans: [number, number][] = [];

  const endOf = (i: number): number => {
    const m = ms[i];
    for (let j = i + 1; j < ms.length; j++) {
      const n = ms[j];
      if (m.kind === "heading") {
        if (n.kind === "heading" && n.depth <= m.depth) return n.line;
      } else {
        if (n.kind === "heading") return n.line;
        if (n.depth <= m.depth && !n.id!.startsWith(`${m.id}.`)) return n.line;
      }
    }
    return lines.length;
  };

  if (/^\d+(?:\.\d+)*$/.test(q)) {
    ms.forEach((m, i) => {
      if (m.id === q || (m.kind === "heading" && new RegExp(`^${q.replace(/\./g, "\\.")}\\.?(\\s|$)`).test(m.title))) spans.push([m.line, endOf(i)]);
    });
  }
  const norm = (t: string) => t.replace(/\s+/g, " ").toLowerCase();
  const needle = norm(q);
  if (!spans.length && needle) {
    ms.forEach((m, i) => {
      if (norm(m.title).includes(needle)) spans.push([m.line, endOf(i)]);
    });
  }

  let parts: string[];
  if (spans.length) {
    // Drop spans nested inside an earlier one.
    const kept = spans.filter(([s, e], i) => !spans.some(([s2, e2], j) => j !== i && s2 <= s && e <= e2 && (s2 < s || e < e2)));
    parts = kept.map(([s, e]) => lines.slice(s, e).join("\n").trim());
  } else {
    parts = needle ? text.split(/\n\s*\n/).filter((p) => norm(p).includes(needle)).slice(0, 8).map((p) => p.trim()) : [];
  }

  let out = parts.join("\n\n…\n\n");
  const truncated = out.length > SECTION_MAX_CHARS;
  if (truncated) out = `${out.slice(0, SECTION_MAX_CHARS).trimEnd()}\n\n[cut at ${SECTION_MAX_CHARS.toLocaleString("en-US")} characters; ask for a narrower section]`;
  return { query, found: parts.length > 0, text: out, truncated };
}
