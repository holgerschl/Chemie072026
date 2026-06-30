"use strict";

const state = {
  tasks: [],
  filtered: [],
  currentId: null,
  done: new Set(JSON.parse(localStorage.getItem("done") || "[]")),
};

const el = {
  list: document.getElementById("task-list"),
  topicFilter: document.getElementById("topic-filter"),
  empty: document.getElementById("task-empty"),
  card: document.getElementById("task-card"),
  number: document.getElementById("task-number"),
  topic: document.getElementById("task-topic"),
  type: document.getElementById("task-type"),
  question: document.getElementById("task-question"),
  given: document.getElementById("task-given"),
  answer: document.getElementById("answer"),
  feedback: document.getElementById("feedback"),
  hint: document.getElementById("hint-box"),
  solution: document.getElementById("solution-box"),
  progress: document.getElementById("progress-text"),
  btnEval: document.getElementById("btn-evaluate"),
  btnH1: document.getElementById("btn-hint1"),
  btnH2: document.getElementById("btn-hint2"),
  btnH3: document.getElementById("btn-hint3"),
  btnSol: document.getElementById("btn-solution"),
  btnNext: document.getElementById("btn-next"),
};

function renderMath(node) {
  if (window.renderMathInElement) {
    window.renderMathInElement(node, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  }
}

function saveDone() {
  localStorage.setItem("done", JSON.stringify([...state.done]));
}

function updateProgress() {
  el.progress.textContent = `${state.done.size} / ${state.tasks.length} bearbeitet`;
}

function renderList() {
  el.list.innerHTML = "";
  state.filtered.forEach((t) => {
    const li = document.createElement("li");
    li.dataset.id = t.id;
    if (state.done.has(t.id)) li.classList.add("done");
    if (state.currentId === t.id) li.classList.add("active");
    const num = document.createElement("span");
    num.textContent = t.number || t.id;
    const topic = document.createElement("span");
    topic.className = "mini-topic";
    topic.textContent = t.topic || "";
    li.appendChild(num);
    li.appendChild(topic);
    li.addEventListener("click", () => selectTask(t.id));
    el.list.appendChild(li);
  });
}

function selectTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  state.currentId = id;
  renderList();
  el.empty.hidden = true;
  el.card.hidden = false;
  el.number.textContent = t.number || t.id;
  el.topic.textContent = t.topic || "";
  el.type.textContent = t.type || "";
  el.question.textContent = t.question || "";
  el.given.textContent = t.given ? `Gegeben: ${t.given}` : "";
  el.answer.value = localStorage.getItem(`answer:${id}`) || "";
  el.feedback.hidden = true;
  el.hint.hidden = true;
  el.solution.hidden = true;
  el.btnSol.disabled = !t.has_solution;
  el.btnEval.disabled = !t.has_solution;
  renderMath(el.question);
  renderMath(el.given);
  // Subtasks anh\u00e4ngen
  if (t.subtasks && t.subtasks.length) {
    const ol = document.createElement("ol");
    ol.style.marginTop = "8px";
    t.subtasks.forEach((s) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${s.id || ""}</strong> ${s.question || ""}`;
      ol.appendChild(li);
    });
    el.question.appendChild(ol);
    renderMath(ol);
  }
  // URL Hash
  if (location.hash !== `#${id}`) {
    history.replaceState(null, "", `#${id}`);
  }
}

el.answer.addEventListener("input", () => {
  if (state.currentId) {
    localStorage.setItem(`answer:${state.currentId}`, el.answer.value);
  }
});

el.topicFilter.addEventListener("change", () => {
  const v = el.topicFilter.value;
  state.filtered = v ? state.tasks.filter((t) => (t.topic || "") === v) : state.tasks.slice();
  renderList();
});

el.btnNext.addEventListener("click", () => {
  const idx = state.filtered.findIndex((t) => t.id === state.currentId);
  if (idx >= 0 && idx + 1 < state.filtered.length) {
    selectTask(state.filtered[idx + 1].id);
  }
});

async function postJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json();
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json();
}

function setBusy(button, on) {
  if (on) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${button.dataset.label}`;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.label || button.textContent;
  }
}

el.btnEval.addEventListener("click", async () => {
  if (!state.currentId) return;
  const answer = el.answer.value.trim();
  if (!answer) {
    alert("Bitte zuerst etwas in das Antwortfeld schreiben.");
    return;
  }
  setBusy(el.btnEval, true);
  el.feedback.hidden = true;
  try {
    const res = await postJson("/api/evaluate", { task_id: state.currentId, answer });
    showFeedback(res);
    if (res.verdict === "correct" || res.score >= 80) {
      state.done.add(state.currentId);
      saveDone();
      updateProgress();
      renderList();
    }
  } catch (err) {
    showFeedback({ verdict: "unclear", score: 0, feedback: `Fehler: ${err.message}`, correct_points: [], missing_points: [] });
  } finally {
    setBusy(el.btnEval, false);
  }
});

function showFeedback(res) {
  el.feedback.hidden = false;
  el.feedback.className = "feedback";
  if (res.verdict === "correct") el.feedback.classList.add("correct");
  else if (res.verdict === "partially_correct") el.feedback.classList.add("partial");
  else if (res.verdict === "incorrect") el.feedback.classList.add("incorrect");

  let html = `<div class="score">Bewertung: ${labelFor(res.verdict)} (${res.score}/100)</div>`;
  html += `<div>${escapeHtml(res.feedback)}</div>`;
  if (res.correct_points && res.correct_points.length) {
    html += `<div style="margin-top:6px"><em>Richtig:</em><ul class="points-correct">${res.correct_points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul></div>`;
  }
  if (res.missing_points && res.missing_points.length) {
    html += `<div style="margin-top:6px"><em>Noch verbesserungsw\u00fcrdig:</em><ul class="points-missing">${res.missing_points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul></div>`;
  }
  el.feedback.innerHTML = html;
  renderMath(el.feedback);
}

function labelFor(v) {
  return ({ correct: "richtig", partially_correct: "teilweise richtig", incorrect: "falsch", unclear: "unklar" })[v] || v;
}

async function askHint(level) {
  if (!state.currentId) return;
  const btn = { 1: el.btnH1, 2: el.btnH2, 3: el.btnH3 }[level];
  setBusy(btn, true);
  el.hint.hidden = true;
  try {
    const res = await postJson("/api/hint", {
      task_id: state.currentId,
      level,
      previous_answer: el.answer.value.trim() || null,
    });
    el.hint.hidden = false;
    el.hint.innerHTML = `<div class="level">Tipp \u2013 Stufe ${res.level}</div><div>${escapeHtml(res.hint)}</div>`;
    renderMath(el.hint);
  } catch (err) {
    el.hint.hidden = false;
    el.hint.textContent = `Fehler: ${err.message}`;
  } finally {
    setBusy(btn, false);
  }
}

el.btnH1.addEventListener("click", () => askHint(1));
el.btnH2.addEventListener("click", () => askHint(2));
el.btnH3.addEventListener("click", () => askHint(3));

el.btnSol.addEventListener("click", async () => {
  if (!state.currentId) return;
  if (!confirm("Wirklich die Musterl\u00f6sung ansehen?")) return;
  setBusy(el.btnSol, true);
  try {
    const res = await getJson(`/api/solution/${encodeURIComponent(state.currentId)}`);
    el.solution.hidden = false;
    let html = `<h3>Musterl\u00f6sung</h3><div>${escapeHtml(res.answer)}</div>`;
    if (res.key_points && res.key_points.length) {
      html += `<div style="margin-top:6px"><strong>Kernpunkte:</strong><ul>${res.key_points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul></div>`;
    }
    if (res.final_result) {
      html += `<div class="final">Endergebnis: ${escapeHtml(res.final_result)}</div>`;
    }
    el.solution.innerHTML = html;
    renderMath(el.solution);
  } catch (err) {
    el.solution.hidden = false;
    el.solution.textContent = `Fehler: ${err.message}`;
  } finally {
    setBusy(el.btnSol, false);
  }
});

function escapeHtml(s) {
  // Wir wollen LaTeX-Delimiter erhalten, daher nur grundlegendes Escaping
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

(async function init() {
  try {
    const data = await getJson("/api/tasks");
    state.tasks = data.tasks;
    state.filtered = data.tasks.slice();
    (data.topics || []).forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      el.topicFilter.appendChild(opt);
    });
    updateProgress();
    renderList();
    const startId = location.hash.replace(/^#/, "") || (data.tasks[0] && data.tasks[0].id);
    if (startId) selectTask(startId);
    else el.empty.textContent = "Keine Aufgaben gefunden. Bitte zuerst scripts/extract_pdfs.py ausf\u00fchren.";
  } catch (err) {
    el.empty.textContent = `Fehler beim Laden: ${err.message}`;
  }
})();
