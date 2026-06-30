"use strict";

/* =============================================================
 *  Säuren & Basen – Lern-App (statisch, GitHub-Pages-fähig)
 *  Spricht direkt mit der Anthropic-API. Der API-Key wird
 *  ausschließlich im localStorage des Browsers gehalten.
 * ============================================================ */

const LS = {
  KEY: "anthropic_api_key",
  MODEL: "anthropic_model",
  DONE: "done",
  SHOW_PROGRESS: "show_progress",
  ANSWER_PREFIX: "answer:",
};

const DEFAULT_MODEL = "claude-sonnet-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const state = {
  tasks: [],
  filtered: [],
  currentId: null,
  done: new Set(JSON.parse(localStorage.getItem(LS.DONE) || "[]")),
  showProgress: localStorage.getItem(LS.SHOW_PROGRESS) !== "0",
};

const el = (id) => document.getElementById(id);
const ui = {
  list: el("task-list"),
  topicFilter: el("topic-filter"),
  search: el("search"),
  empty: el("task-empty"),
  card: el("task-card"),
  number: el("task-number"),
  topic: el("task-topic"),
  type: el("task-type"),
  question: el("task-question"),
  given: el("task-given"),
  answer: el("answer"),
  feedback: el("feedback"),
  hint: el("hint-box"),
  solution: el("solution-box"),
  progress: el("progress-text"),
  btnEval: el("btn-evaluate"),
  btnH1: el("btn-hint1"),
  btnH2: el("btn-hint2"),
  btnH3: el("btn-hint3"),
  btnSol: el("btn-solution"),
  btnNext: el("btn-next"),
  btnMenu: el("btn-menu"),
  btnCloseSidebar: el("btn-close-sidebar"),
  btnSettings: el("btn-settings"),
  btnPrev: el("btn-prev"),
  btnNextTop: el("btn-next-top"),
  backdrop: el("backdrop"),
  sidebar: el("sidebar"),
  dialog: el("settings-dialog"),
  apiKey: el("api-key"),
  modelSel: el("model"),
  showProgressChk: el("show-progress"),
  btnSaveSettings: el("btn-save-settings"),
  btnCancelSettings: el("btn-cancel-settings"),
  btnClearProgress: el("btn-clear-progress"),
};

/* ------------------- Helpers ------------------- */
// Einfache Chemie-Formel-Darstellung:
//   _x  ->  <sub>x</sub>      (x = einzelnes Zeichen oder Gruppe in {...})
//   ^x  ->  <sup>x</sup>
// Beispiele:  H_3O^+,  Ca^2+,  K_a,  SO_4^{2-},  H_2SO_4,  pH = -log[H_3O^+]
// Falls die KI doch LaTeX zurückschickt, werden $...$/$$...$$ und gängige
// Befehle (\frac, \cdot, \rightarrow, ...) entschärft.
function renderChem(text) {
  if (text == null) return "";
  let s = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Dollar-Delimiter entfernen (Inhalt behalten)
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, "$1");
  s = s.replace(/\$([^$\n]+?)\$/g, "$1");

  // Häufige LaTeX-Befehle in Unicode/Klartext umsetzen
  const symMap = {
    "\\cdot": "\u00b7",
    "\\times": "\u00d7",
    "\\rightarrow": "\u2192",
    "\\Rightarrow": "\u21d2",
    "\\leftarrow": "\u2190",
    "\\Leftarrow": "\u21d0",
    "\\leftrightarrow": "\u2194",
    "\\Leftrightarrow": "\u21d4",
    "\\to": "\u2192",
    "\\pm": "\u00b1",
    "\\mp": "\u2213",
    "\\approx": "\u2248",
    "\\neq": "\u2260",
    "\\geq": "\u2265",
    "\\leq": "\u2264",
    "\\ge": "\u2265",
    "\\le": "\u2264",
    "\\Delta": "\u0394",
    "\\alpha": "\u03b1",
    "\\beta": "\u03b2",
    "\\gamma": "\u03b3",
    "\\infty": "\u221e",
    "\\circ": "\u00b0",
  };
  for (const k in symMap) {
    s = s.replace(new RegExp(k.replace(/\\/g, "\\\\"), "g"), symMap[k]);
  }
  s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2");
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, "\u221a($1)");
  s = s.replace(/\\sqrt/g, "\u221a");
  s = s.replace(/\\log/g, "log").replace(/\\ln/g, "ln");
  s = s.replace(/\\text\{([^{}]*)\}/g, "$1");
  // übrig gebliebene Backslash-Kommandos bzw. \\ entfernen
  s = s.replace(/\\\\/g, "<br>");
  s = s.replace(/\\([a-zA-Z]+)\s?/g, "$1");

  // Sub-/Superscript mit Gruppe in {...}
  s = s.replace(/_\{([^{}]+)\}/g, "<sub>$1</sub>");
  s = s.replace(/\^\{([^{}]+)\}/g, "<sup>$1</sup>");
  // Sub-/Superscript ohne Klammern: Buchstaben/Ziffern/+/-/=
  s = s.replace(/_([A-Za-z0-9+\-=]+)/g, "<sub>$1</sub>");
  s = s.replace(/\^([A-Za-z0-9+\-=]+)/g, "<sup>$1</sup>");

  // Zeilenumbrüche
  s = s.replace(/\r?\n/g, "<br>");
  return s;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function saveDone() {
  localStorage.setItem(LS.DONE, JSON.stringify([...state.done]));
}

function updateProgress() {
  if (!state.showProgress) {
    ui.progress.textContent = "";
    return;
  }
  ui.progress.textContent = `${state.done.size} / ${state.tasks.length} bearbeitet`;
}

function getApiKey() { return localStorage.getItem(LS.KEY) || ""; }
function getModel() { return localStorage.getItem(LS.MODEL) || DEFAULT_MODEL; }

function setBusy(button, on) {
  if (!button) return;
  if (on) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${button.dataset.label}`;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.label || button.textContent;
  }
}

/* ------------------- Sidebar (Drawer) ------------------- */
function openSidebar() {
  document.body.classList.add("sidebar-open");
  ui.backdrop.hidden = false;
  ui.btnMenu.setAttribute("aria-expanded", "true");
}
function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  ui.backdrop.hidden = true;
  ui.btnMenu.setAttribute("aria-expanded", "false");
}
ui.btnMenu.addEventListener("click", () =>
  document.body.classList.contains("sidebar-open") ? closeSidebar() : openSidebar()
);
ui.btnCloseSidebar.addEventListener("click", closeSidebar);
ui.backdrop.addEventListener("click", closeSidebar);

/* ------------------- Liste ------------------- */
function applyFilters() {
  const topic = ui.topicFilter.value;
  const q = (ui.search.value || "").trim().toLowerCase();
  state.filtered = state.tasks.filter((t) => {
    if (topic && (t.topic || "") !== topic) return false;
    if (q) {
      const hay = `${t.number || ""} ${t.topic || ""} ${t.question || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  renderList();
}

function renderList() {
  ui.list.innerHTML = "";
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
    li.addEventListener("click", () => {
      selectTask(t.id);
      if (window.matchMedia("(max-width: 760px)").matches) closeSidebar();
    });
    ui.list.appendChild(li);
  });
}

function selectTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  state.currentId = id;
  renderList();
  ui.empty.hidden = true;
  ui.card.hidden = false;
  ui.number.textContent = t.number || t.id;
  ui.topic.textContent = t.topic || "";
  ui.type.textContent = t.type || "";
  ui.question.innerHTML = renderChem(t.question || "");
  ui.given.innerHTML = t.given ? "Gegeben: " + renderChem(t.given) : "";
  ui.answer.value = localStorage.getItem(LS.ANSWER_PREFIX + id) || "";
  ui.feedback.hidden = true;
  ui.hint.hidden = true;
  ui.solution.hidden = true;
  const hasSol = hasSolution(t);
  ui.btnSol.disabled = !hasSol;
  // KI-Bewertung nur sinnvoll, wenn Solution vorhanden
  ui.btnEval.disabled = !hasSol;
  if (t.subtasks && t.subtasks.length) {
    const ol = document.createElement("ol");
    ol.style.marginTop = "8px";
    t.subtasks.forEach((s) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(s.id || "")}</strong> ${renderChem(s.question || "")}`;
      ol.appendChild(li);
    });
    ui.question.appendChild(ol);
  }
  if (location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function hasSolution(t) {
  const s = t && t.solution;
  return !!(s && !s.missing && (s.answer || (s.key_points && s.key_points.length)));
}

ui.answer.addEventListener("input", () => {
  if (state.currentId) localStorage.setItem(LS.ANSWER_PREFIX + state.currentId, ui.answer.value);
});
ui.topicFilter.addEventListener("change", applyFilters);
ui.search.addEventListener("input", applyFilters);

function gotoOffset(delta) {
  const idx = state.filtered.findIndex((t) => t.id === state.currentId);
  const next = idx + delta;
  if (next >= 0 && next < state.filtered.length) selectTask(state.filtered[next].id);
}
ui.btnNext.addEventListener("click", () => gotoOffset(1));
ui.btnPrev.addEventListener("click", () => gotoOffset(-1));
ui.btnNextTop.addEventListener("click", () => gotoOffset(1));

/* ------------------- Anthropic Client ------------------- */
async function callAnthropic(prompt, { maxTokens = 800 } = {}) {
  const key = getApiKey();
  if (!key) {
    throw new Error(
      "Kein Anthropic-API-Key hinterlegt. Bitte oben rechts auf das Zahnrad tippen und Key eintragen."
    );
  }
  const body = {
    model: getModel(),
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail;
    try { detail = (await res.json()).error?.message; } catch { detail = await res.text(); }
    throw new Error(`Anthropic API ${res.status}: ${detail || res.statusText}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text;
}

function parseJsonReply(text) {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "").trim();
  }
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("Antwort enthielt kein JSON: " + text.slice(0, 200));
  return JSON.parse(t.slice(s, e + 1));
}

/* ------------------- Aktionen: Prüfen / Tipp / Lösung ------------------- */
async function evaluate() {
  if (!state.currentId) return;
  const t = state.tasks.find((x) => x.id === state.currentId);
  if (!t) return;
  if (!hasSolution(t)) {
    alert("Für diese Aufgabe ist keine Musterlösung vorhanden — KI-Bewertung nicht möglich.");
    return;
  }
  const answer = ui.answer.value.trim();
  if (!answer) {
    alert("Bitte zuerst etwas in das Antwortfeld schreiben.");
    return;
  }
  setBusy(ui.btnEval, true);
  ui.feedback.hidden = true;
  try {
    const sol = t.solution;
    const prompt =
`Du bist eine erfahrene Chemielehrkraft und bewertest die Antwort einer Schülerin der gymnasialen Oberstufe.

AUFGABE:
${t.question || ""}

${t.given ? "GEGEBEN: " + t.given : ""}

MUSTERLOESUNG:
${sol.answer || ""}

WICHTIGE KERNPUNKTE (die in einer korrekten Antwort vorkommen sollten):
${JSON.stringify(sol.key_points || [])}

ENDERGEBNIS (falls vorhanden): ${sol.final_result || ""}

ANTWORT DER SCHUELERIN:
"""${answer}"""

Bewerte fachlich. Sei wohlwollend bei Formulierungs- und Notationsunterschieden (z.B. H^+ vs. H_3O^+, Komma vs. Punkt als Dezimaltrenner, gerundete Zwischenergebnisse). Sei aber streng bei sachlich falschen Aussagen.

Verwende in Deinem Feedback EINFACHE Formelnotation (KEIN LaTeX, KEINE Dollarzeichen):
  - Subscript mit _ (z.B. H_3O^+, K_a, H_2SO_4)
  - Superscript mit ^ (z.B. Ca^2+, SO_4^2-)
  - Reaktionspfeil als ->

Gib AUSSCHLIESSLICH JSON in folgendem Schema zurück:
{
  "verdict": "correct" | "partially_correct" | "incorrect" | "unclear",
  "score": <Ganzzahl 0–100>,
  "feedback": "<2–5 Sätze konstruktive Rückmeldung auf Deutsch>",
  "correct_points": ["<richtig erkannte Aspekte>"],
  "missing_points": ["<noch fehlende/falsche Aspekte>"]
}`;

    const text = await callAnthropic(prompt, { maxTokens: 1000 });
    const res = parseJsonReply(text);
    showFeedback(res);
    if (res.verdict === "correct" || (res.score || 0) >= 80) {
      state.done.add(state.currentId);
      saveDone();
      updateProgress();
      renderList();
    }
  } catch (err) {
    showFeedback({
      verdict: "unclear",
      score: 0,
      feedback: `Fehler bei der KI-Bewertung: ${err.message}`,
      correct_points: [],
      missing_points: [],
    });
  } finally {
    setBusy(ui.btnEval, false);
  }
}

function showFeedback(res) {
  ui.feedback.hidden = false;
  ui.feedback.className = "feedback";
  if (res.verdict === "correct") ui.feedback.classList.add("correct");
  else if (res.verdict === "partially_correct") ui.feedback.classList.add("partial");
  else if (res.verdict === "incorrect") ui.feedback.classList.add("incorrect");

  const label = ({ correct: "richtig", partially_correct: "teilweise richtig", incorrect: "falsch", unclear: "unklar" })[res.verdict] || res.verdict;
  let html = `<div class="score">Bewertung: ${label} (${res.score || 0}/100)</div>`;
  html += `<div>${renderChem(res.feedback || "")}</div>`;
  if (res.correct_points && res.correct_points.length) {
    html += `<div style="margin-top:8px"><em>Richtig:</em><ul class="points-correct">${res.correct_points.map((p) => `<li>${renderChem(p)}</li>`).join("")}</ul></div>`;
  }
  if (res.missing_points && res.missing_points.length) {
    html += `<div style="margin-top:8px"><em>Noch verbesserungswürdig:</em><ul class="points-missing">${res.missing_points.map((p) => `<li>${renderChem(p)}</li>`).join("")}</ul></div>`;
  }
  ui.feedback.innerHTML = html;
  ui.feedback.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function askHint(level) {
  if (!state.currentId) return;
  const t = state.tasks.find((x) => x.id === state.currentId);
  if (!t) return;
  const btn = { 1: ui.btnH1, 2: ui.btnH2, 3: ui.btnH3 }[level];
  setBusy(btn, true);
  ui.hint.hidden = true;
  try {
    const sol = t.solution || {};
    const levelInstructions = {
      1: "Gib einen sehr kleinen Hinweis: nenne nur das relevante Konzept / die Formel / das Stichwort, das gebraucht wird. KEINE Rechnung, KEIN Ergebnis.",
      2: "Gib einen mittleren Hinweis: skizziere den ersten Schritt oder erkläre, wie man anfängt. KEIN Endergebnis.",
      3: "Gib einen starken Hinweis: erkläre den Rechen- bzw. Argumentationsweg in Stichpunkten, aber halte das Endergebnis zurück oder verschleiere es leicht.",
    };
    const prompt =
`Du bist eine Chemielehrkraft und gibst einer Schülerin (Oberstufe) einen Lerntipp — OHNE die Lösung komplett zu verraten.

AUFGABE:
${t.question || ""}

${t.given ? "GEGEBEN: " + t.given : ""}

MUSTERLOESUNG (NUR zur internen Orientierung, NICHT direkt wiedergeben):
${sol.answer || "(keine vorhanden)"}

KERNPUNKTE:
${JSON.stringify(sol.key_points || [])}

BISHERIGER VERSUCH:
${ui.answer.value.trim() || "(noch nichts geschrieben)"}

HINWEIS-LEVEL: ${level}
${levelInstructions[level] || levelInstructions[1]}

Antworte in 1–3 Sätzen auf Deutsch. Verwende EINFACHE Formelnotation (KEIN LaTeX, KEINE Dollarzeichen):
  - Subscript mit _ (z.B. H_3O^+, K_a, H_2SO_4)
  - Superscript mit ^ (z.B. Ca^2+, SO_4^2-)
  - Reaktionspfeil als ->
Nur Fließtext, kein JSON, kein Markdown-Codeblock.`;

    const text = await callAnthropic(prompt, { maxTokens: 400 });
    ui.hint.hidden = false;
    ui.hint.innerHTML = `<div class="level">Tipp – Stufe ${level}</div><div>${renderChem(text)}</div>`;
    ui.hint.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    ui.hint.hidden = false;
    ui.hint.innerHTML = `<div class="level">Fehler</div><div>${escapeHtml(err.message)}</div>`;
  } finally {
    setBusy(btn, false);
  }
}

function showSolution() {
  if (!state.currentId) return;
  const t = state.tasks.find((x) => x.id === state.currentId);
  if (!t || !hasSolution(t)) {
    alert("Für diese Aufgabe ist keine Musterlösung vorhanden.");
    return;
  }
  if (!confirm("Wirklich die Musterlösung ansehen?")) return;
  const sol = t.solution;
  let html = `<h3>Musterlösung</h3><div>${renderChem(sol.answer || "")}</div>`;
  if (sol.key_points && sol.key_points.length) {
    html += `<div style="margin-top:6px"><strong>Kernpunkte:</strong><ul>${sol.key_points.map((p) => `<li>${renderChem(p)}</li>`).join("")}</ul></div>`;
  }
  if (sol.final_result) {
    html += `<div class="final">Endergebnis: ${renderChem(sol.final_result)}</div>`;
  }
  ui.solution.hidden = false;
  ui.solution.innerHTML = html;
  ui.solution.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

ui.btnEval.addEventListener("click", evaluate);
ui.btnH1.addEventListener("click", () => askHint(1));
ui.btnH2.addEventListener("click", () => askHint(2));
ui.btnH3.addEventListener("click", () => askHint(3));
ui.btnSol.addEventListener("click", showSolution);

/* ------------------- Settings Dialog ------------------- */
function openSettings() {
  ui.apiKey.value = getApiKey();
  ui.modelSel.value = getModel();
  ui.showProgressChk.checked = state.showProgress;
  if (typeof ui.dialog.showModal === "function") ui.dialog.showModal();
  else ui.dialog.setAttribute("open", "");
}
function closeSettings() {
  if (typeof ui.dialog.close === "function") ui.dialog.close();
  else ui.dialog.removeAttribute("open");
}
ui.btnSettings.addEventListener("click", openSettings);
ui.btnCancelSettings.addEventListener("click", closeSettings);
ui.btnSaveSettings.addEventListener("click", () => {
  const key = ui.apiKey.value.trim();
  if (key) localStorage.setItem(LS.KEY, key);
  else localStorage.removeItem(LS.KEY);
  localStorage.setItem(LS.MODEL, ui.modelSel.value || DEFAULT_MODEL);
  state.showProgress = ui.showProgressChk.checked;
  localStorage.setItem(LS.SHOW_PROGRESS, state.showProgress ? "1" : "0");
  updateProgress();
  closeSettings();
});
ui.btnClearProgress.addEventListener("click", () => {
  if (!confirm("Wirklich allen Fortschritt löschen?")) return;
  state.done.clear();
  saveDone();
  // Gespeicherte Antworten ebenfalls löschen
  Object.keys(localStorage)
    .filter((k) => k.startsWith(LS.ANSWER_PREFIX))
    .forEach((k) => localStorage.removeItem(k));
  updateProgress();
  renderList();
  if (state.currentId) selectTask(state.currentId);
});

/* ------------------- Keyboard Shortcuts ------------------- */
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) {
    // Strg+Enter im Textarea = Prüfen
    if (e.target.id === "answer" && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      evaluate();
    }
    return;
  }
  if (e.key === "ArrowRight" || e.key === "j") gotoOffset(1);
  else if (e.key === "ArrowLeft" || e.key === "k") gotoOffset(-1);
  else if (e.key === "?") openSettings();
});

/* ------------------- Touch Swipe (Drawer auf/zu) ------------------- */
let touchStartX = null, touchStartY = null;
document.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
document.addEventListener("touchend", (e) => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  touchStartX = null;
  if (Math.abs(dy) > 60 || Math.abs(dx) < 60) return;
  // Drawer-Geste nur am linken Rand öffnen
  if (!document.body.classList.contains("sidebar-open") && dx > 80 && e.changedTouches[0].clientX < 200 + dx) {
    if (window.matchMedia("(max-width: 760px)").matches) openSidebar();
  } else if (document.body.classList.contains("sidebar-open") && dx < -80) {
    closeSidebar();
  }
}, { passive: true });

/* ------------------- Init ------------------- */
async function init() {
  try {
    const r = await fetch("./data/exercises.json", { cache: "no-store" });
    if (!r.ok) throw new Error("exercises.json nicht gefunden (Status " + r.status + ")");
    const data = await r.json();
    state.tasks = (data.tasks || []).filter((t) => t && t.id);
    state.filtered = state.tasks.slice();
    const topics = [...new Set(state.tasks.map((t) => t.topic).filter(Boolean))].sort();
    topics.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t; opt.textContent = t;
      ui.topicFilter.appendChild(opt);
    });
    updateProgress();
    renderList();
    const startId = location.hash.replace(/^#/, "") || (state.tasks[0] && state.tasks[0].id);
    if (startId) selectTask(startId);
    else ui.empty.textContent = "Keine Aufgaben gefunden.";

    // Wenn noch kein Key gesetzt ist, freundliche Aufforderung beim ersten Start
    if (!getApiKey() && !sessionStorage.getItem("hinted_key")) {
      sessionStorage.setItem("hinted_key", "1");
      setTimeout(() => {
        if (!getApiKey()) openSettings();
      }, 500);
    }
  } catch (err) {
    ui.empty.innerHTML = `Fehler beim Laden der Aufgaben: ${escapeHtml(err.message)}<br><br>Falls Du die Seite lokal öffnest, starte einen kleinen Webserver (z.B. <code>python -m http.server</code> im Ordner <code>docs/</code>) und öffne <code>http://localhost:8000</code>.`;
  }
}
init();
