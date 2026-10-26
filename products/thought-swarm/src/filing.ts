import { decodeHTML } from "entities";
import type { Extracted } from "./extract.js";

// Native streaming parsing avoids constructing a huge JS DOM inside a Worker.
// All filing pages are retained; script/style/hidden machine data are omitted.
export async function streamFiling(response: Response): Promise<Extracted> {
  const cleaned = new HTMLRewriter()
    .on("head,script,style,noscript,template,svg,iframe,[hidden],[aria-hidden='true'],ix\\:hidden", {
      element(element) { element.remove(); },
    }).transform(response);
  const blocks = new Set(["p", "div", "section", "article", "table", "tr", "ul", "ol", "li", "br", "hr"]);
  const stripped = new HTMLRewriter().on("*", {
    element(element) {
      const tag = element.tagName;
      if (tag === "td" || tag === "th") element.before(" | ");
      else if (blocks.has(tag)) {
        element.before("\n");
        element.after("\n");
      } else if (/^h[1-6]$/.test(tag)) {
        element.before(`\n\n${"#".repeat(Number(tag[1]))} `);
        element.after("\n\n");
      }
      element.removeAndKeepContent();
    },
  }).onDocument({ comments(comment) { comment.remove(); } }).transform(cleaned);
  const text = decodeHTML(await stripped.text())
    .replace(/[\t \u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .split("\n").map(line =>
      line.length >= 8 && line.length <= 160 && /[A-Z]{3}/.test(line) && !/[a-z|#]/.test(line)
        ? `## ${line}` : line).join("\n");
  return { title: "", text };
}
