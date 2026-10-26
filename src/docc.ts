// Apple's developer docs (developer.apple.com/documentation and the Human
// Interface Guidelines) are a DocC web app: the HTML is an empty shell and the
// browser fills it in from a JSON file at /tutorials/data/<path>.json. This
// turns that JSON into the same markdown-ish text extractText produces, so
// those pages can be digested like any other.

import type { Extracted } from "./extract.js";

const DOCC_PATH = /^\/(documentation|design\/human-interface-guidelines)(\/|$)/;

/** The DocC JSON URL behind an Apple docs page, or null if the page isn't one. */
export function doccDataUrl(normalizedUrl: string): string | null {
  const url = new URL(normalizedUrl);
  if (url.hostname !== "developer.apple.com" || !DOCC_PATH.test(url.pathname)) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `https://developer.apple.com/tutorials/data${path.toLowerCase()}.json`;
}

type Json = any; // DocC render JSON; only the parts we read are relied on.

const fence = (lang: string, code: string) => "```" + lang + "\n" + code + "\n```";

export function renderDocc(doc: Json): Extracted {
  const refs: Record<string, Json> = doc.references ?? {};
  const out: string[] = [];
  const title: string = doc.metadata?.title ?? "";

  const inline = (nodes: Json[] | undefined): string =>
    (nodes ?? [])
      .map((n) => {
        switch (n.type) {
          case "text":
            return n.text;
          case "codeVoice":
            return `\`${n.code}\``;
          case "strong":
          case "inlineHead":
            return `**${inline(n.inlineContent)}**`;
          case "emphasis":
          case "newTerm":
            return `*${inline(n.inlineContent)}*`;
          case "reference": {
            const r = refs[n.identifier];
            if (!r) return "";
            const text = n.overridingTitle ?? r.title ?? "";
            return r.kind === "symbol" ? `\`${text}\`` : text;
          }
          case "link":
            return n.title ?? n.destination ?? "";
          case "subscript":
          case "superscript":
            return inline(n.inlineContent);
          default:
            return "";
        }
      })
      .join("");

  const blocks = (nodes: Json[] | undefined, indent = ""): string[] => {
    const lines: string[] = [];
    for (const b of nodes ?? []) {
      switch (b.type) {
        case "heading":
          lines.push(`${"#".repeat(Math.min(6, (b.level ?? 2) + 1))} ${b.text}`);
          break;
        case "paragraph":
          lines.push(indent + inline(b.inlineContent));
          break;
        case "codeListing":
          lines.push(fence(b.syntax ?? "", (b.code ?? []).join("\n")));
          break;
        case "unorderedList":
        case "orderedList":
          (b.items ?? []).forEach((item: Json, i: number) => {
            const [first = "", ...rest] = blocks(item.content, indent + "  ");
            lines.push(`${indent}${b.type === "orderedList" ? `${i + 1}.` : "-"} ${first.trimStart()}`, ...rest);
          });
          break;
        case "aside":
          lines.push(...blocks(b.content).map((l, i) => `> ${i === 0 ? `${b.name ?? b.style ?? "Note"}: ` : ""}${l}`));
          break;
        case "termList":
          for (const item of b.items ?? []) {
            lines.push(`- **${inline(item.term?.inlineContent)}**: ${blocks(item.definition?.content).join(" ")}`);
          }
          break;
        case "table": {
          const rows: string[][] = (b.rows ?? []).map((row: Json[]) => row.map((cell: Json[]) => blocks(cell).join(" ").replace(/\|/g, "\\|")));
          if (rows.length) {
            lines.push(`| ${rows[0].join(" | ")} |`, `|${rows[0].map(() => " --- ").join("|")}|`);
            for (const r of rows.slice(1)) lines.push(`| ${r.join(" | ")} |`);
          }
          break;
        }
        case "row":
          for (const col of b.columns ?? []) lines.push(...blocks(col.content, indent));
          break;
        case "tabNavigator":
          for (const tab of b.tabs ?? []) lines.push(`**${tab.title}**`, ...blocks(tab.content, indent));
          break;
        case "links":
          for (const id of b.items ?? []) if (refs[id]?.title) lines.push(`- ${refs[id].title}`);
          break;
        default:
          break; // images, videos, cards: nothing to read
      }
    }
    return lines;
  };

  const tokens = (decl: Json) => (decl.tokens ?? []).map((t: Json) => t.text).join("");

  if (title) out.push(`# ${title}`);
  if (doc.metadata?.roleHeading) out.push(doc.metadata.roleHeading);
  if (doc.abstract) out.push(inline(doc.abstract));

  for (const s of doc.primaryContentSections ?? []) {
    switch (s.kind) {
      case "declarations":
        for (const d of s.declarations ?? []) out.push(fence("swift", tokens(d)));
        break;
      case "parameters":
        out.push("## Parameters");
        for (const p of s.parameters ?? []) out.push(`- \`${p.name}\`: ${blocks(p.content).join(" ")}`);
        break;
      case "properties":
        out.push(`## ${s.title ?? "Properties"}`);
        for (const p of s.items ?? []) {
          const type = (p.type ?? []).map((t: Json) => t.text).join("");
          out.push(`- \`${p.name}\`${type ? ` (${type})` : ""}${p.required ? ", required" : ""}: ${blocks(p.content).join(" ")}`);
        }
        break;
      case "restEndpoint":
        out.push(fence("", (s.tokens ?? []).map((t: Json) => t.text).join("")));
        break;
      case "content":
        out.push(...blocks(s.content));
        break;
      default:
        break; // mentions, relationships: lists of links
    }
  }

  const topics = [...(doc.topicSections ?? [])];
  if (topics.length) {
    out.push("## Topics");
    for (const t of topics) {
      if (t.title) out.push(`### ${t.title}`);
      for (const id of t.identifiers ?? []) {
        const r = refs[id];
        if (!r?.title) continue;
        const abstract = inline(r.abstract);
        out.push(`- ${r.kind === "symbol" ? `\`${r.title}\`` : r.title}${abstract ? `: ${abstract}` : ""}`);
      }
    }
  }

  const text = out
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

/** Links from a DocC page to other pages on developer.apple.com, for building seed lists. */
export function doccLinks(doc: Json): string[] {
  const links = new Set<string>();
  for (const r of Object.values<Json>(doc.references ?? {})) {
    if (typeof r?.url === "string" && DOCC_PATH.test(r.url)) links.add(`https://developer.apple.com${r.url}`);
  }
  return [...links];
}
