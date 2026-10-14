const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const API = "/turrii/api/jam";
let catalog;
let current;
let poll;
let busy = false;
let requestId = sessionStorage.getItem("turrii-jam-request") || crypto.randomUUID();
sessionStorage.setItem("turrii-jam-request", requestId);

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

function renderJam() {
  $("#setup").hidden = true;
  $("#session").hidden = false;
  $("#session-title").textContent = catalog.topics.find((topic) => topic.id === current.topic)?.title || "Your jam";
  $("#participants").textContent = current.people.map((id) => catalog.profiles.find((profile) => profile.id === id)?.name).join(" · ") + " · Simulated lenses, not real participants";
  const done = current.turns.filter((turn) => turn.answer).length;
  $("#rounds").replaceChildren(...roundTitles.map((title, index) => element("div", `${index + 1} / ${title}`, `round ${index < done ? "done" : index === done ? "current" : ""}`)));
  $("#transcript").replaceChildren(...current.turns.flatMap((turn) => [
    entry(`YOU · ROUND ${turn.round}`, turn.user, true),
    ...(turn.answer ? [entry(`TEEK FACILITATOR · ROUND ${turn.round}`, turn.answer, false)] : []),
  ]));
  $("#human-checkpoint").textContent = catalog.humanTurns[Math.min(done, 3)];
  $("#reply-label").textContent = `Your reserved seat · round ${Math.min(done + 1, 4)} of 4`;
  $("#reply").placeholder = catalog.humanTurns[Math.min(done, 3)];
  const failed = current.status === "error";
  $("#contribute").hidden = current.status === "thinking" || current.status === "complete" || current.attempts >= 6;
  $("#completion").hidden = current.status !== "complete";
  $("#reply").readOnly = failed;
  if (failed) $("#reply").value = current.turns.at(-1).user;
  $("#reply-button").textContent = failed ? `Retry saved contribution (${6 - current.attempts} attempts left)` : `Send round ${done + 1} of 4 ↗`;
  $("#reply-button").disabled = busy;
  if (current.status === "thinking") {
    showNotice(`Round ${done + 1} is being considered. You can leave; the result will be saved. No next round runs without you.`);
    schedulePoll();
  } else if (failed) {
    showNotice(current.error, true);
  } else {
    showNotice(current.status === "complete" ? "Complete. Your transcript and final decision memo are saved." : `Your turn. ${done} of 4 rounds complete.`);
  }
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
      consent: $("#consent").checked,
    });
    requestId = crypto.randomUUID();
    sessionStorage.setItem("turrii-jam-request", requestId);
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
  const text = `# Turrii × Teek jam\n\nModel: ${current.model}\nCreated: ${current.created}\nContext hash: ${current.contextHash}\nSimulated perspectives, not actual people or endorsements.\n\n${current.turns.map((turn) => `## Round ${turn.round}\n\n### You\n${turn.user}\n\n### Facilitator\n${turn.answer || "[No completed response]"}`).join("\n\n")}\n\n## Source snapshot\n${JSON.stringify(current.evidence, null, 2)}`;
  const url = URL.createObjectURL(new Blob([text], {type: "text/markdown"}));
  const anchor = element("a");
  anchor.href = url;
  anchor.download = `turrii-jam-${current.id}.md`;
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
