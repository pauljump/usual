"""Versioned, validated speaker turns shared by Proof and every Teek room."""
import json

EVIDENCE_STYLE = """EVIDENCE PRESENTATION v1 — applies to this reply, including ongoing jams.
This replaces earlier instructions to display source paths or claim IDs. Keep grounding in the supplied evidence, but do not put internal filenames, document paths, line numbers, claim IDs, footnotes, citation brackets, or reference lists in the chat or final summary.
Instead, put the useful source wording directly into the reply: a short exact quote followed by why it matters here. Use only wording actually present in the loaded material, preserving its meaning and caveats. Never invent a quotation or turn a paraphrase into a quote. Keep third-party excerpts brief (at most 25 quoted words per source across this response).
Distinguish whose words they are in ordinary language when necessary: “The research summary says …” is not “A customer said …”. A research-summary quote is not a verbatim quote from its underlying study or review unless that original quotation is actually supplied. If exact wording is unavailable, plainly paraphrase and say it is a summary or inference; do not fabricate evidence to satisfy the request for quotes.
Every reply must be understandable without opening another document. Retain uncertainty, conflicting evidence and limitations. Apply this to all speaker replies, the human question and the final summary. This changes presentation only, not the conversation schema, safety boundaries, speaker order or required human turns."""

DIALOGUE_PROMPT = """CONVERSATION FORMAT v2
Write a lively, grounded simulated conversation, not an essay about the participants.
Use first-person arguments in each profile's own conversational turn. These are fictional applications of public writing, never authentic quotes or claims that the real person is present. No invented biography or private beliefs.
Respond directly to the human's latest words and to the preceding speaker: question, disagree, refine or build on a specific point. Avoid parallel mini-essays, generic applause and forced agreement.
Return ONLY a JSON object with keys messages, question, summary. No Markdown fences.
messages is an ordered array of {speaker: selected profile ID, text: spoken reply}.
For rounds 1–3, make exactly TWO passes through the selected IDs in their supplied order (4–6 replies total), about 40–90 words per reply. No narrator or human messages. The last reply hands the floor to the human. question is ONE focused question for the human, and summary is null. Do not summarize or produce a decision memo yet.
Round 1 explores the brain dump; round 2 challenges the direction; round 3 sharpens an experiment and invites the human's final call.
Round 4 follows the human's final contribution: ONE pass through the selected IDs, brief closing replies, then summary as a plain-text final memo distinguishing actual human decisions, recommendations, dissent, unresolved questions, evidence gaps and next steps. Never turn proposals into commitments. question is null. No further round.
Never write their contribution: the human must take their own turn. End the response at that boundary. Ground replies in supplied evidence; never invent sources."""


def parse_dialogue(text, people, round_number):
    data = json.loads(text)
    order = people if round_number == 4 else people * 2

    def valid_text(value, maximum):
        return isinstance(value, str) and bool(value.strip()) and len(value) <= maximum

    if not isinstance(data, dict) or not isinstance(data.get("messages"), list):
        raise ValueError("Invalid conversation response")
    messages = data["messages"]
    if len(messages) != len(order) or any(
        not isinstance(message, dict) or message.get("speaker") != speaker or not valid_text(message.get("text"), 2400)
        for message, speaker in zip(messages, order)
    ):
        raise ValueError("Invalid speaker turns")
    if round_number == 4:
        if data.get("question") is not None or not valid_text(data.get("summary"), 10000):
            raise ValueError("Final summary required")
    elif not valid_text(data.get("question"), 1000) or data.get("summary") is not None:
        raise ValueError("Human turn required; summary must wait")
    return {"messages": [{"speaker": item["speaker"], "text": item["text"].strip()} for item in messages],
            "question": data.get("question"), "summary": data.get("summary")}
