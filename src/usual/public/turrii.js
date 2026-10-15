const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const API = document.body.dataset.jamApi || "/turrii/api/jam";
const roomName = document.body.dataset.jamName || "Turrii";
const requestKey = API === "/turrii/api/jam" ? "turrii-jam-request" : API + ":request";
let catalog;
let current;
let poll;
let busy = false;
let requestId = sessionStorage.getItem(requestKey) || crypto.randomUUID();
sessionStorage.setItem(requestKey, requestId);

const roundTitles = ["You frame it", "You challenge it", "You choose a test", "You decide"];

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showNotice(text, error = false) {
  $("#notice").textContent = text;
  $("#notice").classList.toggle("error", error);
}

async function api(path = "", body) {
  const response = await fetch(API + path, {
    cache: "no-store",
    ...(body ? {
      method: "POST",
      headers: {"content-type": "application/json", "x-jam-request": "1"},
      body: JSON.stringify(body),
    } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function refresh() {
  catalog = await api();
  $("#quota").textContent = `${catalog.used} / ${catalog.limit}`;
  $("#start-button").disabled = !catalog.ready || !catalog.remaining || busy;
  $("#start-button").textContent = !catalog.ready
    ? "Waiting for API setup"
    : !catalog.remaining
      ? "Both seats are in the archive"
      : "Start this jam ↗";
  renderArchive();
}

function renderSetup() {
  catalog.topics.forEach((topic, index) => {
    const button = element("button", null, "topic");
    button.type = "button";
    button.dataset.id = topic.id;
    button.setAttribute("aria-pressed", String(index === 0));
    button.append(element("strong", topic.title), element("small", topic.subtitle));
    button.onclick = () => $$(".topic").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    $("#topics").append(button);
  });
  const profiles = [...catalog.profiles].sort((left, right) => left.name.split(" ").at(-1).localeCompare(right.name.split(" ").at(-1)));
  profiles.forEach((profile) => {
    const label = element("label", null, "person");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.value = profile.id;
    checkbox.onchange = () => {
      if ($$("#people input:checked").length > 3) {
        checkbox.checked = false;
        showNotice("Choose at most three lenses. Your own seat is reserved.", true);
      }
    };
    label.append(checkbox, element("span", profile.initials, "avatar"), element("strong", profile.name), element("small", profile.lens), element("small", profile.evidenceLabel, "evidence"));
    $("#people").append(label);
  });
}

function renderArchive() {
  const records = $("#records");
  records.replaceChildren();
  if (!catalog.jams.length) {
    records.append(element("div", "No jams yet. The first position is yours.", "empty"));
    return;
  }
  catalog.jams.forEach((jam) => {
    const row = element("div", null, "record");
    const button = element("button", catalog.topics.find((topic) => topic.id === jam.topic)?.title || jam.topic);
    button.type = "button";
    button.onclick = () => openJam(jam.id);
    row.append(button, element("span", `${jam.rounds}/4 rounds · ${jam.status} · ${new Date(jam.created).toLocaleDateString()}`));
    records.append(row);
  });
}

function bodyText(text) {
  const box = element("div", null, "body");
  for (const block of text.split(/\n\n+/)) {
    box.append(/^#{1,4} /.test(block) ? element("h3", block.replace(/^#{1,4} /, "")) : element("p", block));
  }
  return box;
}

function entry(label, text, human) {
  const node = element("article", null, `entry${human ? " human" : ""}`);
  node.append(element("div", label, "tag"), bodyText(text));
  return node;
}


function speakerName(id) {
  return catalog.profiles.find(profile => profile.id === id)?.name || id;
}
function conversationEntries(turn) {
  const entries = [entry(`YOU · TURN ${turn.round} OF 4`, turn.user, true)];
  if (!turn.answer) return entries;
  if (!turn.dialogue) {
    entries.push(entry('LEGACY FACILITATOR RESPONSE', turn.answer, false));
    return entries;
  }
  for (const message of turn.dialogue.messages) {
    const bubble = entry(speakerName(message.speaker), message.text, false);
    bubble.classList.add('speaker', 'speaker-' + current.people.indexOf(message.speaker));
    bubble.dataset.initials = catalog.profiles.find(profile => profile.id === message.speaker)?.initials || speakerName(message.speaker).split(' ').map(word => word[0]).slice(0, 2).join('');
    bubble.append(element('small', 'Simulated profile', 'speaker-note'));
    entries.push(bubble);
  }
  if (turn.dialogue.question) {
    const handoff = entry('YOUR TURN', turn.dialogue.question, false);
    handoff.classList.add('handoff');
    entries.push(handoff);
  }
  if (turn.round === 4 && turn.dialogue.summary) {
    const summary = entry('FINAL SUMMARY', turn.dialogue.summary, false);
    summary.classList.add('final-summary');
    entries.push(summary);
  }
  return entries;
}
function exportTurn(turn) {
  let text = `## Your turn ${turn.round}\n\n### You\n${turn.user}\n\n`;
  if (!turn.dialogue) return text + (turn.answer || '[No completed response]');
  text += turn.dialogue.messages.map(message => `### ${speakerName(message.speaker)} (simulated)\n${message.text}`).join('\n\n');
  if (turn.dialogue.question) text += '\n\n### Your turn\n' + turn.dialogue.question;
  if (turn.round === 4 && turn.dialogue.summary) text += '\n\n### Final summary\n' + turn.dialogue.summary;
  return text;
}

let playbackTimer;
let playbackActive = false;
const playbackSeen = new Map();
function playbackCount(key) {
  if (playbackSeen.has(key)) return playbackSeen.get(key);
  try { return Math.max(0, Number(sessionStorage.getItem(key)) || 0); } catch { return 0; }
}
function rememberPlayback(key, count) {
  playbackSeen.set(key, count);
  try { sessionStorage.setItem(key, String(count)); } catch {}
}
function renderChatTranscript() {
  clearTimeout(playbackTimer);
  playbackActive = false;
  const transcript = $('#transcript');
  const stickToBottom = transcript.dataset.jam !== current.id || transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 100;
  const position = transcript.scrollTop;
  const last = current.turns.at(-1);
  const key = 'teek-playback:' + location.pathname + ':' + current.id + ':' + last?.round;
  const nodes = current.turns.slice(0, -1).flatMap(conversationEntries);
  const latest = last ? conversationEntries(last) : [];
  const replies = last?.dialogue?.messages || [];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const count = reduced ? replies.length : Math.min(replies.length, playbackCount(key));
  if (reduced) rememberPlayback(key, count);
  if (last?.answer && replies.length && count < replies.length) {
    playbackActive = true;
    nodes.push(...latest.slice(0, 1 + count));
    const pending = element('div', null, 'chat-playback');
    pending.setAttribute('role', 'status');
    pending.append(element('span', '•••', 'chat-dots'), element('span', 'Up next: ' + speakerName(replies[count].speaker) + ' · saved reply'));
    const skip = element('button', 'Show all now', 'secondary');
    skip.type = 'button';
    const id = current.id;
    skip.onclick = () => {
      if (current?.id !== id) return;
      rememberPlayback(key, replies.length);
      renderJam();
    };
    pending.append(skip);
    nodes.push(pending);
    const delay = count === 0 ? 1400 : Math.min(6000, Math.max(2200, replies[count - 1].text.length * 12));
    playbackTimer = setTimeout(() => {
      if (current?.id !== id || $('#session').hidden) return;
      rememberPlayback(key, count + 1);
      renderJam();
    }, delay);
  } else nodes.push(...latest);
  transcript.replaceChildren(...nodes);
  transcript.dataset.jam = current.id;
  transcript.scrollTop = stickToBottom ? transcript.scrollHeight : position;
}
function playbackControls() {
  if (!playbackActive) return;
  $('#contribute').hidden = true;
  $('#completion').hidden = true;
  showNotice('Playing saved replies one at a time. Your turn follows this exchange.');
}

function renderJam() {
  $("#setup").hidden = true;
  $("#session").hidden = false;
  $("#session-title").textContent = catalog.topics.find((topic) => topic.id === current.topic)?.title || "Your jam";
  $("#participants").textContent = current.people.map((id) => catalog.profiles.find((profile) => profile.id === id)?.name).join(" · ") + " · Simulated lenses, not real participants";
  const done = current.turns.filter((turn) => turn.answer).length;
  $("#rounds").replaceChildren(...roundTitles.map((title, index) => element("div", `${index + 1} / ${title}`, `round ${index < done ? "done" : index === done ? "current" : ""}`)));
  renderChatTranscript();
  $("#human-checkpoint").textContent = current.turns.filter(turn => turn.answer).at(-1)?.dialogue?.question || catalog.humanTurns[Math.min(done, 3)];
  $("#reply-label").textContent = `Your turn ${Math.min(done + 1, 4)} of 4 · the conversation waits for you`;
  $("#reply").placeholder = catalog.humanTurns[Math.min(done, 3)];
  const failed = current.status === "error";
  $("#contribute").hidden = current.status === "thinking" || current.status === "complete" || current.attempts >= 6;
  $("#completion").hidden = current.status !== "complete";
  $("#reply").readOnly = failed;
  if (failed) $("#reply").value = current.turns.at(-1).user;
  $("#reply-button").textContent = failed ? `Retry saved contribution (${6 - current.attempts} attempts left)` : "Send ↑";
  $("#reply-button").disabled = busy;
  if (current.status === "thinking") {
    showNotice(`Round ${done + 1} is being considered. You can leave; the result will be saved. No next round runs without you.`);
    schedulePoll();
  } else if (failed) {
    showNotice(current.error, true);
  } else {
    showNotice(current.status === "complete" ? "Complete. Your conversation and final summary are saved." : `Your turn. ${done} of 4 rounds complete.`);
  }
  playbackControls();
}

function schedulePoll() {
  clearTimeout(poll);
  const id = current.id;
  poll = setTimeout(async () => {
    try {
      const next = await api("/" + id);
      if (current?.id !== id) return;
      current = next;
      renderJam();
      if (next.status !== "thinking") await refresh();
    } catch (error) {
      showNotice(error.message + " Reopen the saved jam to check its status.", true);
    }
  }, 2200);
}

async function openJam(id) {
  try {
    clearTimeout(poll);
    current = await api("/" + id);
    history.replaceState(null, "", "#jam=" + id);
    renderJam();
    $("#session").scrollIntoView({block: "start"});
  } catch (error) {
    showNotice(error.message, true);
  }
}

$("#start").onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;
  const people = $$("#people input:checked").map((item) => item.value);
  if (people.length < 2) {
    showNotice("Choose at least two lenses.", true);
    return;
  }
  busy = true;
  $("#start-button").disabled = true;
  try {
    current = await api("", {
      requestId,
      topic: $(".topic[aria-pressed=true]").dataset.id,
      people,
      text: $("#opening").value,
    });
    requestId = crypto.randomUUID();
    sessionStorage.setItem(requestKey, requestId);
    history.replaceState(null, "", "#jam=" + current.id);
    renderJam();
    await refresh();
    $("#session").scrollIntoView({block: "start"});
  } catch (error) {
    showNotice(error.message + " If the connection dropped, check the archive before submitting again.", true);
    await refresh().catch(() => {});
  } finally {
    busy = false;
    $("#start-button").disabled = !catalog.ready || !catalog.remaining;
  }
};

$("#contribute").onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  $("#reply-button").disabled = true;
  try {
    current = await api("/" + current.id, {text: $("#reply").value, round: current.turns.filter((turn) => turn.answer).length + 1});
    $("#reply").value = "";
    renderJam();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    busy = false;
    $("#reply-button").disabled = false;
  }
};

$("#back").onclick = async () => {
  clearTimeout(poll);
  clearTimeout(playbackTimer);
  playbackActive = false;
  current = null;
  history.replaceState(null, "", location.pathname);
  $("#session").hidden = true;
  $("#setup").hidden = false;
  try {
    await refresh();
    showNotice(catalog.ready ? "Choose a decision and bring a point of view." : "Anthropic credentials still need setup; no jam slots have been used.", !catalog.ready);
  } catch (error) {
    showNotice(error.message, true);
  }
};

$("#export").onclick = () => {
  if (!current) return;
  const text = `# ${roomName} × Teek jam\n\nModel: ${current.model}\nCreated: ${current.created}\nContext hash: ${current.contextHash}\nSimulated perspectives, not actual people or endorsements.\n\n${current.turns.map(exportTurn).join("\n\n")}\n\n## Source snapshot\n${JSON.stringify(current.evidence, null, 2)}`;
  const url = URL.createObjectURL(new Blob([text], {type: "text/markdown"}));
  const anchor = element("a");
  anchor.href = url;
  anchor.download = `teek-jam-${current.id}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

(async () => {
  try {
    await refresh();
    renderSetup();
    showNotice(catalog.ready ? "Two jams. Four rounds. No autopilot." : "The room is ready, but Anthropic credentials need setup. No slots used.", !catalog.ready);
    if (location.hash.startsWith("#jam=")) await openJam(location.hash.slice(5));
  } catch (error) {
    showNotice(error.message, true);
  }
})();
