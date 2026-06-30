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
  interactive: el("interactive-area"),
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

/* ------------------- Interaktive Aufgaben (Karten verschieben) ------------------- */
// Vergleicht zwei Antworten "weich": trimmt, kleinschreibt, En-/Em-Dashes
// werden zu Bindestrich, Whitespace egal, _ ^ { } werden ignoriert
// (damit "Na_2SO_4" und "Na2SO4" gleich behandelt werden).
function normalizeAnswer(s) {
  return String(s == null ? "" : s)
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\{\}_^]/g, "")
    .replace(/\s+/g, "");
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function splitClozeQuestion(text) {
  const paras = String(text || "").split(/\n\n+/);
  const bodyIdx = paras.findIndex((p) => /_{4,}/.test(p));
  if (bodyIdx < 0) return { header: text || "", body: "" };
  return {
    header: paras.slice(0, bodyIdx).join("\n\n"),
    body: paras.slice(bodyIdx).join("\n\n"),
  };
}

// Globales "Tap-Select": gilt f\u00fcr alle interaktiven Widgets,
// damit dieselbe Karte auf einem Widget ausgew\u00e4hlt und in einem
// Slot/Bin abgelegt werden kann.
let interactiveSelectedCard = null;

function selectInteractiveCard(card) {
  if (interactiveSelectedCard === card) {
    interactiveSelectedCard.classList.remove("selected");
    interactiveSelectedCard = null;
    return;
  }
  if (interactiveSelectedCard) interactiveSelectedCard.classList.remove("selected");
  interactiveSelectedCard = card;
  if (card) card.classList.add("selected");
}

function clearInteractiveSelection() {
  if (interactiveSelectedCard) interactiveSelectedCard.classList.remove("selected");
  interactiveSelectedCard = null;
}

function makeCard(value, displayHtml) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "card";
  if (typeof value === "string" && value.length > 22) b.classList.add("long");
  b.dataset.value = value;
  b.draggable = false; // wir nutzen Pointer-Events statt HTML5-DnD
  b.innerHTML = displayHtml != null ? displayHtml : renderChem(value);
  return b;
}

function markTaskDone() {
  if (!state.currentId) return;
  state.done.add(state.currentId);
  saveDone();
  updateProgress();
  renderList();
}

function renderInteractive(task) {
  const host = ui.interactive;
  host.innerHTML = "";
  clearInteractiveSelection();
  const form = ui.answer && ui.answer.form;
  if (form) form.classList.remove("with-interactive");
  const cfg = task && task.interactive;
  if (!cfg) { host.hidden = true; return; }
  host.hidden = false;

  let widget = null;
  if (cfg.type === "matching") widget = buildMatchingWidget(task, cfg);
  else if (cfg.type === "cloze") widget = buildClozeWidget(task, cfg);
  else if (cfg.type === "cloze-cards") widget = buildClozeCardsWidget(task, cfg);
  else if (cfg.type === "categorize") widget = buildCategorizeWidget(task, cfg);
  else if (cfg.type === "table") widget = buildTableWidget(task, cfg);
  else if (cfg.type === "quiz") widget = buildQuizWidget(task, cfg);
  if (widget) {
    host.appendChild(widget);
    if (form) form.classList.add("with-interactive");
  } else {
    host.hidden = true;
  }
}

/* ---- Matching: Item links, 1 oder mehrere Karten rechts ---- */
function buildMatchingWidget(task, cfg) {
  const wrap = document.createElement("div");
  wrap.className = "interactive matching";

  const intro = document.createElement("div");
  intro.className = "interactive-intro muted small";
  intro.innerHTML =
    '<strong>Ziehe</strong> die Karten auf den passenden Platz – ' +
    'oder tippe zuerst eine Karte und dann einen Platz. Eine Karte zur\u00fcck ' +
    'in den Vorrat ziehst (oder tippst) Du genauso.';
  wrap.appendChild(intro);

  const isMulti = Array.isArray(cfg.pools) && cfg.pools.length > 0;

  // Zeilen mit Slots aufbauen
  const slotsList = document.createElement("ul");
  slotsList.className = "match-slots" + (isMulti ? " multi" : "");
  if (isMulti) slotsList.style.setProperty("--match-cols", String(cfg.pools.length));

  cfg.items.forEach((item, idx) => {
    const li = document.createElement("li");
    li.className = "match-row" + (isMulti ? " multi" : "");
    const lbl = document.createElement("span");
    lbl.className = "match-label";
    lbl.innerHTML = renderChem(item.label);
    li.appendChild(lbl);

    if (isMulti) {
      cfg.pools.forEach((p) => {
        const slot = document.createElement("div");
        slot.className = "slot";
        slot.dataset.idx = String(idx);
        slot.dataset.poolKey = p.key;
        const expected = (item.answers && item.answers[p.key]) || "";
        slot.dataset.expected = expected;
        slot.setAttribute("tabindex", "0");
        slot.setAttribute("role", "button");
        slot.setAttribute("aria-label", p.label + " f\u00fcr " + item.label);
        li.appendChild(slot);
      });
    } else {
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.dataset.idx = String(idx);
      slot.dataset.expected = item.answer;
      slot.setAttribute("tabindex", "0");
      slot.setAttribute("role", "button");
      slot.setAttribute("aria-label", "Platz f\u00fcr " + item.label);
      li.appendChild(slot);
    }
    slotsList.appendChild(li);
  });
  wrap.appendChild(slotsList);

  // Pools aufbauen
  const poolsByKey = {};
  let defaultPool;
  if (isMulti) {
    cfg.pools.forEach((p) => {
      const section = document.createElement("div");
      section.className = "card-pool-section";
      const label = document.createElement("div");
      label.className = "card-pool-label muted small";
      label.textContent = p.label;
      const pool = document.createElement("div");
      pool.className = "card-pool";
      pool.dataset.poolKey = p.key;
      pool.setAttribute("aria-label", p.label);
      section.appendChild(label);
      section.appendChild(pool);
      wrap.appendChild(section);
      poolsByKey[p.key] = pool;

      const values = [];
      const seen = new Set();
      cfg.items.forEach((it) => {
        const v = it.answers && it.answers[p.key];
        if (v != null && !seen.has(v)) { seen.add(v); values.push(v); }
      });
      shuffleInPlace(values).forEach((v) => {
        const card = makeCard(v);
        card.dataset.poolKey = p.key;
        pool.appendChild(card);
      });
    });
    defaultPool = poolsByKey[cfg.pools[0].key];
  } else {
    const uniqueAnswers = [];
    const seen = new Set();
    cfg.items.forEach((it) => {
      if (!seen.has(it.answer)) { seen.add(it.answer); uniqueAnswers.push(it.answer); }
    });
    const cards = shuffleInPlace(uniqueAnswers.slice());
    defaultPool = document.createElement("div");
    defaultPool.className = "card-pool";
    defaultPool.setAttribute("aria-label", "Kartenvorrat");
    cards.forEach((v) => defaultPool.appendChild(makeCard(v)));
    wrap.appendChild(defaultPool);
  }

  const result = document.createElement("div");
  result.className = "interactive-result";
  result.hidden = true;

  function poolForCard(card) {
    const key = card && card.dataset && card.dataset.poolKey;
    if (key && poolsByKey[key]) return poolsByKey[key];
    return defaultPool;
  }
  function canPlace(card, slot) {
    if (!isMulti) return true;
    return slot.dataset.poolKey === card.dataset.poolKey;
  }

  const totalSlots = isMulti ? cfg.items.length * cfg.pools.length : cfg.items.length;

  const actions = buildActions({
    onCheck: () => {
      let correct = 0;
      let allPlaced = true;
      slotsList.querySelectorAll(".slot").forEach((slot) => {
        const c = slot.querySelector(".card");
        slot.classList.remove("ok", "bad");
        if (!c) { allPlaced = false; return; }
        const ok = normalizeAnswer(c.dataset.value) === normalizeAnswer(slot.dataset.expected);
        slot.classList.add(ok ? "ok" : "bad");
        if (ok) correct++;
      });
      showResult(result, correct, totalSlots, allPlaced);
    },
    onReset: () => {
      slotsList.querySelectorAll(".slot .card").forEach((c) => poolForCard(c).appendChild(c));
      slotsList.querySelectorAll(".slot").forEach((s) => s.classList.remove("ok", "bad"));
      result.hidden = true;
      clearInteractiveSelection();
    },
  });

  wrap.appendChild(actions);
  wrap.appendChild(result);

  const wireOpts = { poolFor: poolForCard, canPlace };
  wireCardSlotTaps(wrap, defaultPool, ".slot", result, wireOpts);
  wireCardDrag(wrap, defaultPool, ".slot", result, wireOpts);
  return wrap;
}

/* ---- Cloze: Wort-Karten in L\u00fccken im Flie\u00dftext ---- */
function buildClozeWidget(task, cfg) {
  const wrap = document.createElement("div");
  wrap.className = "interactive cloze";

  const intro = document.createElement("div");
  intro.className = "interactive-intro muted small";
  intro.innerHTML =
    '<strong>Ziehe</strong> die Wort-Karten in die richtigen L\u00fccken – ' +
    'oder tippe zuerst eine Karte und dann eine L\u00fccke. Eine Karte zur\u00fcck ' +
    'in den Vorrat ziehst (oder tippst) Du genauso.';
  wrap.appendChild(intro);

  // Cloze body text
  const textBox = document.createElement("div");
  textBox.className = "cloze-text";
  const { body } = splitClozeQuestion(task.question);
  const parts = String(body || task.question || "").split(/_{4,}/);
  parts.forEach((part, i) => {
    const span = document.createElement("span");
    span.className = "cloze-frag";
    span.innerHTML = renderChem(part);
    textBox.appendChild(span);
    if (i < cfg.blanks.length) {
      const slot = document.createElement("span");
      slot.className = "slot inline-slot";
      slot.dataset.idx = String(i);
      slot.dataset.expected = cfg.blanks[i];
      slot.setAttribute("tabindex", "0");
      slot.setAttribute("role", "button");
      slot.setAttribute("aria-label", "L\u00fccke " + (i + 1));
      textBox.appendChild(slot);
    }
  });
  wrap.appendChild(textBox);

  // Pool: alle Blank-Antworten als Karten (inkl. Duplikaten), gemischt
  const cards = shuffleInPlace(cfg.blanks.slice());
  const pool = document.createElement("div");
  pool.className = "card-pool";
  pool.setAttribute("aria-label", "Wortkarten");
  cards.forEach((v) => pool.appendChild(makeCard(v)));
  wrap.appendChild(pool);

  const result = document.createElement("div");
  result.className = "interactive-result";
  result.hidden = true;

  const actions = buildActions({
    onCheck: () => {
      let correct = 0;
      const total = cfg.blanks.length;
      let allPlaced = true;
      textBox.querySelectorAll(".slot").forEach((slot) => {
        const c = slot.querySelector(".card");
        slot.classList.remove("ok", "bad");
        if (!c) { allPlaced = false; return; }
        const ok = normalizeAnswer(c.dataset.value) === normalizeAnswer(slot.dataset.expected);
        slot.classList.add(ok ? "ok" : "bad");
        if (ok) correct++;
      });
      showResult(result, correct, total, allPlaced);
    },
    onReset: () => {
      textBox.querySelectorAll(".slot .card").forEach((c) => pool.appendChild(c));
      textBox.querySelectorAll(".slot").forEach((s) => s.classList.remove("ok", "bad"));
      result.hidden = true;
      clearInteractiveSelection();
    },
  });

  wrap.appendChild(actions);
  wrap.appendChild(result);
  wireCardSlotTaps(wrap, pool, ".slot", result);
  wireCardDrag(wrap, pool, ".slot", result);
  return wrap;
}

/* ---- Cloze-Cards: Mehrere Abschnitte mit \u00dcberschrift und L\u00fcckentext, gemeinsame Kartenablage ---- */
function buildClozeCardsWidget(task, cfg) {
  const wrap = document.createElement("div");
  wrap.className = "interactive cloze cloze-cards";

  const intro = document.createElement("div");
  intro.className = "interactive-intro muted small";
  intro.innerHTML =
    '<strong>Ziehe</strong> die Karten in die passenden L\u00fccken \u2013 ' +
    'oder tippe zuerst eine Karte und dann eine L\u00fccke. Eine Karte zur\u00fcck ' +
    'in den Vorrat ziehst (oder tippst) Du genauso.';
  wrap.appendChild(intro);

  const sections = Array.isArray(cfg.sections) ? cfg.sections : [];
  const allAnswers = [];
  let blankCount = 0;

  sections.forEach((section) => {
    const sect = document.createElement("section");
    sect.className = "cloze-section";

    const title = document.createElement("h4");
    title.className = "cloze-section-title";
    title.innerHTML = renderChem(section.title || "");
    sect.appendChild(title);

    const textBox = document.createElement("div");
    textBox.className = "cloze-text";
    const parts = String(section.body || "").split(/_{4,}/);
    const answers = Array.isArray(section.answers) ? section.answers : [];
    parts.forEach((part, i) => {
      const span = document.createElement("span");
      span.className = "cloze-frag";
      span.innerHTML = renderChem(part);
      textBox.appendChild(span);
      if (i < answers.length) {
        const slot = document.createElement("span");
        slot.className = "slot inline-slot";
        slot.dataset.idx = String(blankCount);
        slot.dataset.expected = answers[i];
        slot.setAttribute("tabindex", "0");
        slot.setAttribute("role", "button");
        slot.setAttribute("aria-label", "L\u00fccke " + (blankCount + 1));
        textBox.appendChild(slot);
        allAnswers.push(answers[i]);
        blankCount++;
      }
    });
    sect.appendChild(textBox);
    wrap.appendChild(sect);
  });

  const pool = document.createElement("div");
  pool.className = "card-pool";
  pool.setAttribute("aria-label", "Wortkarten");
  shuffleInPlace(allAnswers.slice()).forEach((v) => pool.appendChild(makeCard(v)));
  wrap.appendChild(pool);

  const result = document.createElement("div");
  result.className = "interactive-result";
  result.hidden = true;

  const actions = buildActions({
    onCheck: () => {
      let correct = 0;
      const total = blankCount;
      let allPlaced = true;
      wrap.querySelectorAll(".slot").forEach((slot) => {
        const c = slot.querySelector(".card");
        slot.classList.remove("ok", "bad");
        if (!c) { allPlaced = false; return; }
        const ok = normalizeAnswer(c.dataset.value) === normalizeAnswer(slot.dataset.expected);
        slot.classList.add(ok ? "ok" : "bad");
        if (ok) correct++;
      });
      showResult(result, correct, total, allPlaced);
    },
    onReset: () => {
      wrap.querySelectorAll(".slot .card").forEach((c) => pool.appendChild(c));
      wrap.querySelectorAll(".slot").forEach((s) => s.classList.remove("ok", "bad"));
      result.hidden = true;
      clearInteractiveSelection();
    },
  });

  wrap.appendChild(actions);
  wrap.appendChild(result);
  wireCardSlotTaps(wrap, pool, ".slot", result);
  wireCardDrag(wrap, pool, ".slot", result);
  return wrap;
}

/* ---- Quiz: Single-Choice pro Frage ---- */
function buildQuizWidget(task, cfg) {
  const wrap = document.createElement("div");
  wrap.className = "interactive quiz";

  const intro = document.createElement("div");
  intro.className = "interactive-intro muted small";
  intro.innerHTML = "W\u00e4hle pro Frage die richtige Antwort aus.";
  wrap.appendChild(intro);

  const questions = Array.isArray(cfg.questions) ? cfg.questions : [];
  const groupSeed = "quiz_" + Math.random().toString(36).slice(2, 8) + "_";

  questions.forEach((q, qi) => {
    const block = document.createElement("section");
    block.className = "quiz-question";
    block.dataset.idx = String(qi);

    const stem = document.createElement("div");
    stem.className = "quiz-stem";
    stem.innerHTML = renderChem(q.stem || "");
    block.appendChild(stem);

    const list = document.createElement("div");
    list.className = "quiz-options";
    const groupName = groupSeed + qi;
    (q.options || []).forEach((opt, oi) => {
      const label = document.createElement("label");
      label.className = "quiz-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = groupName;
      input.value = String(oi);
      input.dataset.correct = opt && opt.correct ? "1" : "0";
      const span = document.createElement("span");
      span.className = "quiz-option-text";
      span.innerHTML = renderChem((opt && opt.text) || "");
      label.appendChild(input);
      label.appendChild(span);
      list.appendChild(label);
    });
    block.appendChild(list);
    wrap.appendChild(block);
  });

  const result = document.createElement("div");
  result.className = "interactive-result";
  result.hidden = true;

  const actions = buildActions({
    onCheck: () => {
      let correct = 0;
      let answered = 0;
      const total = questions.length;
      wrap.querySelectorAll(".quiz-question").forEach((block) => {
        block.querySelectorAll(".quiz-option").forEach((l) =>
          l.classList.remove("ok", "bad")
        );
        const chosen = block.querySelector("input:checked");
        if (chosen) {
          answered++;
          const wrapper = chosen.closest(".quiz-option");
          const isCorrect = chosen.dataset.correct === "1";
          wrapper.classList.add(isCorrect ? "ok" : "bad");
          if (isCorrect) correct++;
        }
      });
      showResult(result, correct, total, answered >= total);
    },
    onReset: () => {
      wrap.querySelectorAll("input[type=radio]").forEach((i) => {
        i.checked = false;
      });
      wrap.querySelectorAll(".quiz-option").forEach((l) =>
        l.classList.remove("ok", "bad")
      );
      result.hidden = true;
    },
  });

  wrap.appendChild(actions);
  wrap.appendChild(result);
  return wrap;
}

/* ---- Categorize: Karten in Kategorie-K\u00e4sten ablegen ---- */
function buildCategorizeWidget(task, cfg) {
  const wrap = document.createElement("div");
  wrap.className = "interactive categorize";

  const intro = document.createElement("div");
  intro.className = "interactive-intro muted small";
  intro.innerHTML =
    '<strong>Ziehe</strong> die Karten in die richtige Kategorie-Box – ' +
    'oder tippe zuerst eine Karte und dann eine Box. Eine Karte zur\u00fcck ' +
    'in den Vorrat ziehst (oder tippst) Du genauso.';
  wrap.appendChild(intro);

  // Map card value -> richtige Kategorie-Beschriftung
  const valueToCategory = new Map();
  const allCards = [];

  const bins = document.createElement("div");
  bins.className = "categorize-bins";
  cfg.categories.forEach((cat, idx) => {
    const bin = document.createElement("div");
    bin.className = "bin";
    bin.dataset.idx = String(idx);
    bin.dataset.label = cat.label;
    const h = document.createElement("div");
    h.className = "bin-label";
    h.innerHTML = renderChem(cat.label);
    const drop = document.createElement("div");
    drop.className = "slot bin-drop";
    drop.dataset.idx = String(idx);
    drop.dataset.label = cat.label;
    drop.setAttribute("tabindex", "0");
    drop.setAttribute("role", "button");
    drop.setAttribute("aria-label", "Box: " + cat.label);
    bin.appendChild(h);
    bin.appendChild(drop);
    bins.appendChild(bin);
    cat.answers.forEach((a) => {
      valueToCategory.set(a, cat.label);
      allCards.push(a);
    });
  });
  wrap.appendChild(bins);

  const pool = document.createElement("div");
  pool.className = "card-pool";
  pool.setAttribute("aria-label", "Kartenvorrat");
  shuffleInPlace(allCards).forEach((v) => pool.appendChild(makeCard(v)));
  wrap.appendChild(pool);

  const result = document.createElement("div");
  result.className = "interactive-result";
  result.hidden = true;

  const actions = buildActions({
    onCheck: () => {
      let correct = 0;
      let placed = 0;
      const total = allCards.length;
      // Reset markings on every card
      wrap.querySelectorAll(".bin-drop .card").forEach((c) => {
        c.classList.remove("ok", "bad");
      });
      bins.querySelectorAll(".bin-drop").forEach((drop) => {
        const expectedLabel = drop.dataset.label;
        drop.querySelectorAll(".card").forEach((card) => {
          placed++;
          const targetLabel = valueToCategory.get(card.dataset.value);
          const ok = targetLabel === expectedLabel;
          card.classList.add(ok ? "ok" : "bad");
          if (ok) correct++;
        });
      });
      showResult(result, correct, total, placed >= total);
    },
    onReset: () => {
      bins.querySelectorAll(".bin-drop .card").forEach((c) => {
        c.classList.remove("ok", "bad");
        pool.appendChild(c);
      });
      result.hidden = true;
      clearInteractiveSelection();
    },
  });

  wrap.appendChild(actions);
  wrap.appendChild(result);
  wireCardSlotTaps(wrap, pool, ".bin-drop", result, { multipleCardsPerSlot: true });
  wireCardDrag(wrap, pool, ".bin-drop", result, { multipleCardsPerSlot: true });
  return wrap;
}

/* ---- Table: Tabelle mit Eingabefeldern ---- */
function buildTableWidget(task, cfg) {
  const wrap = document.createElement("div");
  wrap.className = "interactive tableinput";

  const intro = document.createElement("div");
  intro.className = "interactive-intro muted small";
  intro.innerHTML = cfg.intro ||
    'Tippe in jede leere Zelle die richtige Antwort. Unter- und Hochstellung ' +
    'kannst Du einfach mit <code>_</code> und <code>^</code> schreiben, also ' +
    '<code>NaCl</code>, <code>CaCl_2</code>, <code>(NH_4)_2SO_4</code>.';
  wrap.appendChild(intro);

  // Brauchen wir eine Zeilen-Kopf-Spalte?
  const hasRowLabels = cfg.rows.some((r) => r && r.label != null && r.label !== "");

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "interactive-table";

  // header
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  if (hasRowLabels) headerRow.appendChild(document.createElement("th"));
  cfg.columns.forEach((col) => {
    const th = document.createElement("th");
    th.innerHTML = renderChem(col);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // body
  const tbody = document.createElement("tbody");
  cfg.rows.forEach((row) => {
    const tr = document.createElement("tr");
    if (hasRowLabels) {
      const rowLabel = document.createElement("th");
      rowLabel.scope = "row";
      rowLabel.innerHTML = renderChem(row.label || "");
      tr.appendChild(rowLabel);
    }
    row.answers.forEach((cell) => {
      const td = document.createElement("td");
      // Zelle vorgegeben? -> nur Text anzeigen, kein Eingabefeld
      if (cell && typeof cell === "object" && cell.given != null) {
        td.className = "cell-given";
        td.innerHTML = renderChem(String(cell.given));
      } else {
        const expected = typeof cell === "string"
          ? cell
          : (cell && cell.expected) || "";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "cell-input";
        input.autocomplete = "off";
        input.autocapitalize = "off";
        input.spellcheck = false;
        input.dataset.expected = expected;
        td.appendChild(input);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);

  const result = document.createElement("div");
  result.className = "interactive-result";
  result.hidden = true;

  const actions = buildActions({
    onCheck: () => {
      let correct = 0;
      let total = 0;
      let allFilled = true;
      table.querySelectorAll(".cell-input").forEach((inp) => {
        total++;
        inp.classList.remove("ok", "bad");
        if (!inp.value.trim()) { allFilled = false; return; }
        const ok = normalizeAnswer(inp.value) === normalizeAnswer(inp.dataset.expected);
        inp.classList.add(ok ? "ok" : "bad");
        if (ok) correct++;
      });
      showResult(result, correct, total, allFilled);
    },
    onReset: () => {
      table.querySelectorAll(".cell-input").forEach((inp) => {
        inp.value = "";
        inp.classList.remove("ok", "bad");
      });
      result.hidden = true;
    },
    showSolutionsButton: true,
    onShowSolutions: () => {
      table.querySelectorAll(".cell-input").forEach((inp) => {
        if (!inp.value.trim()) {
          inp.value = inp.dataset.expected;
          inp.classList.add("ok");
        }
      });
    },
  });

  wrap.appendChild(actions);
  wrap.appendChild(result);
  return wrap;
}

/* ---- Gemeinsame Helpers f\u00fcr die Widgets ---- */
function buildActions({ onCheck, onReset, showSolutionsButton, onShowSolutions }) {
  const actions = document.createElement("div");
  actions.className = "interactive-actions";
  const btnCheck = document.createElement("button");
  btnCheck.type = "button";
  btnCheck.className = "primary";
  btnCheck.textContent = "Pr\u00fcfen";
  btnCheck.addEventListener("click", onCheck);
  const btnReset = document.createElement("button");
  btnReset.type = "button";
  btnReset.textContent = "Zur\u00fccksetzen";
  btnReset.addEventListener("click", onReset);
  actions.appendChild(btnCheck);
  actions.appendChild(btnReset);
  if (showSolutionsButton && onShowSolutions) {
    const btnSol = document.createElement("button");
    btnSol.type = "button";
    btnSol.className = "ghost";
    btnSol.textContent = "L\u00f6sungen einf\u00fcllen";
    btnSol.addEventListener("click", () => {
      if (confirm("Wirklich die korrekten L\u00f6sungen in alle leeren Felder einf\u00fcllen?")) {
        onShowSolutions();
      }
    });
    actions.appendChild(btnSol);
  }
  return actions;
}

function showResult(result, correct, total, allPlaced) {
  result.hidden = false;
  result.className = "interactive-result";
  if (!allPlaced && correct < total) {
    result.classList.add("partial");
    result.textContent = `${correct} von ${total} richtig \u2013 noch nicht alles ausgef\u00fcllt.`;
  } else if (correct === total) {
    result.classList.add("ok");
    result.textContent = `Super! Alle ${total} richtig.`;
    markTaskDone();
  } else {
    result.classList.add("partial");
    result.textContent = `${correct} von ${total} richtig.`;
  }
}

// Wires up click handling on the whole widget so a card can be tap-selected
// in the pool, then a slot can be tapped to place it. Cards already in a slot
// are sent back to the pool when tapped.
// poolSelector: CSS-Klasse des Pools (z.\u202fB. ".card-pool")
// slotSelector: CSS-Selektor der Slots/Bins (z.\u202fB. ".slot" oder ".bin-drop")
function wireCardSlotTaps(wrap, pool, slotSelector, result, opts) {
  opts = opts || {};
  const poolFor = (card) => {
    if (typeof opts.poolFor === "function") {
      const p = opts.poolFor(card);
      if (p) return p;
    }
    return pool;
  };
  const canPlace = (card, slot) => {
    if (typeof opts.canPlace === "function") return !!opts.canPlace(card, slot);
    return true;
  };
  wrap.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    const slot = e.target.closest(slotSelector);
    if (card) {
      const inSlot = card.parentElement && (card.parentElement.matches(slotSelector) ||
                                            card.parentElement.classList.contains("slot"));
      if (inSlot) {
        const s = card.parentElement;
        poolFor(card).appendChild(card);
        card.classList.remove("selected", "ok", "bad");
        s.classList.remove("ok", "bad");
        if (result) result.hidden = true;
        clearInteractiveSelection();
      } else {
        selectInteractiveCard(card);
      }
      e.stopPropagation();
      return;
    }
    if (slot && interactiveSelectedCard) {
      const card2 = interactiveSelectedCard;
      if (!canPlace(card2, slot)) {
        // Falscher Stapel für diesen Slot – nichts tun.
        return;
      }
      if (!opts.multipleCardsPerSlot) {
        const existing = slot.querySelector(".card");
        if (existing) poolFor(existing).appendChild(existing);
      }
      slot.appendChild(card2);
      card2.classList.remove("selected", "ok", "bad");
      slot.classList.remove("ok", "bad");
      clearInteractiveSelection();
      if (result) result.hidden = true;
    }
  });
  // Tastatur: Enter/Space auf Slot mit ausgew\u00e4hlter Karte
  wrap.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && interactiveSelectedCard) {
      const slot = e.target.closest(slotSelector);
      if (slot && canPlace(interactiveSelectedCard, slot)) {
        e.preventDefault();
        if (!opts.multipleCardsPerSlot) {
          const existing = slot.querySelector(".card");
          if (existing) poolFor(existing).appendChild(existing);
        }
        slot.appendChild(interactiveSelectedCard);
        interactiveSelectedCard.classList.remove("selected");
        slot.classList.remove("ok", "bad");
        clearInteractiveSelection();
        if (result) result.hidden = true;
      }
    }
  });
}

// Pointer-basiertes Drag & Drop f\u00fcr Karten. Funktioniert mit Maus,
// Finger (Touch) und Stift, auf iPad genauso wie auf Desktop.
// Bei einer reinen Tipp-Geste (keine nennenswerte Bewegung) bleibt
// das normale Tap-Select aus wireCardSlotTaps aktiv.
function wireCardDrag(wrap, pool, slotSelector, result, opts) {
  opts = opts || {};
  let ds = null;
  let suppressNextClick = false;

  wrap.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const card = e.target.closest(".card");
    if (!card || !wrap.contains(card)) return;
    const r = card.getBoundingClientRect();
    ds = {
      card,
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - r.left, offsetY: e.clientY - r.top,
      width: r.width, height: r.height,
      moved: false,
      ghost: null,
    };
  });

  wrap.addEventListener("pointermove", (e) => {
    if (!ds || e.pointerId !== ds.pointerId) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.moved) {
      if (dx * dx + dy * dy < 36) return; // <6px = noch kein Drag
      ds.moved = true;
      const g = ds.card.cloneNode(true);
      g.classList.add("drag-ghost");
      g.classList.remove("selected", "ok", "bad");
      g.style.position = "fixed";
      g.style.left = "0px";
      g.style.top = "0px";
      g.style.width = ds.width + "px";
      g.style.margin = "0";
      g.style.pointerEvents = "none";
      g.style.zIndex = "9999";
      document.body.appendChild(g);
      ds.ghost = g;
      ds.card.classList.add("dragging");
      try { ds.card.setPointerCapture(ds.pointerId); } catch (_) { /* ignore */ }
    }
    ds.ghost.style.transform =
      "translate(" + (e.clientX - ds.offsetX) + "px, " +
                     (e.clientY - ds.offsetY) + "px) rotate(2deg)";

    ds.ghost.style.display = "none";
    const under = document.elementFromPoint(e.clientX, e.clientY);
    ds.ghost.style.display = "";
    wrap.querySelectorAll(".drop-hover").forEach((x) => x.classList.remove("drop-hover"));
    const target = resolveDropTarget(under, ds.card);
    if (target) target.classList.add("drop-hover");
    e.preventDefault();
  });

  wrap.addEventListener("pointerup",     (e) => endDrag(e, false));
  wrap.addEventListener("pointercancel", (e) => endDrag(e, true));
  wrap.addEventListener("lostpointercapture", (e) => endDrag(e, true));

  function endDrag(e, cancelled) {
    if (!ds || e.pointerId !== ds.pointerId) return;
    const cur = ds;
    if (!cur.moved) { ds = null; return; }

    cur.ghost.style.display = "none";
    const under = cancelled ? null : document.elementFromPoint(e.clientX, e.clientY);
    cur.ghost.remove();
    cur.card.classList.remove("dragging");
    wrap.querySelectorAll(".drop-hover").forEach((x) => x.classList.remove("drop-hover"));
    try { cur.card.releasePointerCapture(cur.pointerId); } catch (_) { /* ignore */ }
    ds = null;
    suppressNextClick = true;
    // Nach naechstem Click-Event Flag wieder ausschalten (siehe capture-Handler unten)

    if (!cancelled) {
      const target = resolveDropTarget(under, cur.card);
      if (target) placeCard(cur.card, target);
    }
  }

  function resolveDropTarget(el, card) {
    if (!el) return null;
    const slot = el.closest(slotSelector);
    if (slot && wrap.contains(slot)) {
      if (typeof opts.canPlace === "function" && !opts.canPlace(card, slot)) return null;
      return slot;
    }
    const inPool = el.closest(".card-pool");
    if (inPool && wrap.contains(inPool)) return inPool;
    return null;
  }

  function placeCard(card, target) {
    const isPool = target.classList && target.classList.contains("card-pool");
    const homePool = (typeof opts.poolFor === "function" && opts.poolFor(card)) || pool;
    if (isPool) {
      // Bei Mehr-Pool-Widgets immer in den Heimat-Pool zur\u00fccklegen,
      // egal auf welchen Pool gedroppt wurde.
      homePool.appendChild(card);
    } else {
      if (!opts.multipleCardsPerSlot) {
        const existing = target.querySelector(".card");
        if (existing && existing !== card) {
          const existingHome = (typeof opts.poolFor === "function" && opts.poolFor(existing)) || pool;
          existingHome.appendChild(existing);
        }
      }
      target.appendChild(card);
      target.classList.remove("ok", "bad");
    }
    card.classList.remove("selected", "ok", "bad");
    clearInteractiveSelection();
    if (result) result.hidden = true;
  }

  // Unterdrueckt den Tap-Click direkt nach einem Drag, damit die
  // gerade abgelegte Karte nicht sofort wieder selektiert wird.
  wrap.addEventListener("click", (e) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
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
  // Bei Cloze-Aufgaben zeigen wir oben nur den Kopf (Anweisung + Wortliste),
  // der eigentliche L\u00fcckentext wandert ins interaktive Widget.
  let questionToShow = t.question || "";
  if (t.interactive && t.interactive.type === "cloze") {
    const { header } = splitClozeQuestion(t.question || "");
    questionToShow = header || "Erg\u00e4nze den L\u00fcckentext unten.";
  }
  ui.question.innerHTML = renderChem(questionToShow);
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
  renderInteractive(t);
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
