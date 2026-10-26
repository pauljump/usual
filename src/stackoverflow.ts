// Stack Overflow question pages refuse plain fetches, but Stack Exchange runs
// an official public API and licenses the content for reuse with attribution
// (CC BY-SA). For a stackoverflow.com/questions/<id> URL the fetcher reads the
// question and its top answers through that API, and the digest carries an
// attribution line naming the authors and the license.

import { extractText, type Extracted } from "./extract.js";

const API = "https://api.stackexchange.com/2.3";
const QUESTION_PATH = /^\/(?:questions|q)\/(\d+)(?:\/|$)/;
const MAX_ANSWERS = 3;

/** The question id for a Stack Overflow question URL, or null. */
export function stackOverflowQuestionId(normalizedUrl: string): string | null {
  const url = new URL(normalizedUrl);
  if (url.hostname !== "stackoverflow.com" && url.hostname !== "www.stackoverflow.com") return null;
  return QUESTION_PATH.exec(url.pathname)?.[1] ?? null;
}

export function stackExchangeUrls(id: string, key?: string): { question: string; answers: string } {
  const k = key ? `&key=${encodeURIComponent(key)}` : "";
  return {
    question: `${API}/questions/${id}?site=stackoverflow&filter=withbody${k}`,
    answers: `${API}/questions/${id}/answers?site=stackoverflow&sort=votes&order=desc&pagesize=10&filter=withbody${k}`,
  };
}

type Json = any; // Stack Exchange API response; only the fields we read are relied on.

export interface StackOverflowPage extends Extracted {
  attribution: string;
}

/** Renders a question and its accepted and top-voted answers. Null if the question doesn't exist. */
export function renderStackOverflow(questionRes: Json, answersRes: Json): StackOverflowPage | null {
  const q = questionRes?.items?.[0];
  if (!q) return null;
  const title = decodeEntities(q.title ?? "");
  const all: Json[] = answersRes?.items ?? [];
  const accepted = all.find((a) => a.is_accepted);
  const answers = [...(accepted ? [accepted] : []), ...all.filter((a) => a !== accepted)].slice(0, MAX_ANSWERS);

  const name = (o: Json) => decodeEntities(o?.owner?.display_name ?? "a deleted user");
  const body = (html: string) => extractText(`<!doctype html><html><body><main>${html ?? ""}</main></body></html>`).text;

  const out = [
    `# ${title}`,
    `Stack Overflow question, score ${q.score ?? 0}${q.tags?.length ? `, tagged ${q.tags.join(", ")}` : ""}. Asked by ${name(q)}.`,
    body(q.body),
  ];
  for (const a of answers) {
    out.push(`## ${a.is_accepted ? "Accepted answer" : "Answer"} by ${name(a)} (score ${a.score ?? 0})`, body(a.body));
  }
  if (!answers.length) out.push("No answers yet.");

  const answerers = [...new Set(answers.map(name))];
  const license = q.content_license ? q.content_license.replace(/_/g, "-").replace(/^CC-BY-SA-/, "CC BY-SA ") : "CC BY-SA";
  const attribution =
    `"${title}" on Stack Overflow, asked by ${name(q)}` +
    (answerers.length ? `, answers by ${answerers.join(", ")}` : "") +
    `. Licensed ${license}: ${q.link ?? `https://stackoverflow.com/questions/${q.question_id}`}`;

  return { title, text: out.join("\n\n").trim(), attribution };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
