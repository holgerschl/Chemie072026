"""FastAPI-Backend f\u00fcr die S\u00e4uren-und-Basen-Lern-App.

Endpunkte:
    GET  /                 \u2192 Frontend
    GET  /api/tasks        \u2192 alle Aufgaben (ohne L\u00f6sungen)
    GET  /api/tasks/{id}   \u2192 einzelne Aufgabe (ohne L\u00f6sung)
    POST /api/evaluate     \u2192 KI-Bewertung der Antwort
    POST /api/hint         \u2192 KI-Tipp zur Aufgabe (ohne L\u00f6sung zu verraten)
    GET  /api/solution/{id} \u2192 vollst\u00e4ndige Musterl\u00f6sung
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DATA_FILE = ROOT / "data" / "exercises.json"
STATIC_DIR = ROOT / "webapp" / "static"

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
MODEL_EVAL = os.environ.get("ANTHROPIC_MODEL_EVAL", "claude-sonnet-4-5").strip()

if not API_KEY:
    raise RuntimeError(
        "ANTHROPIC_API_KEY fehlt. Bitte in .env eintragen."
    )

client = anthropic.Anthropic(api_key=API_KEY)
app = FastAPI(title="Chemie Lern-App \u2014 S\u00e4uren & Basen")


# ---------------------------------------------------------------------------
# Aufgaben laden
# ---------------------------------------------------------------------------
def load_tasks() -> list[dict[str, Any]]:
    if not DATA_FILE.exists():
        raise RuntimeError(
            f"{DATA_FILE} fehlt. Bitte zuerst scripts/extract_pdfs.py ausf\u00fchren."
        )
    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    return payload.get("tasks", [])


TASKS = load_tasks()
TASKS_BY_ID = {t["id"]: t for t in TASKS}


def _public_task(task: dict[str, Any]) -> dict[str, Any]:
    """Aufgabe ohne L\u00f6sung herausgeben."""
    return {
        "id": task.get("id"),
        "number": task.get("number"),
        "topic": task.get("topic"),
        "type": task.get("type"),
        "question": task.get("question"),
        "given": task.get("given"),
        "expected_answer_kind": task.get("expected_answer_kind"),
        "subtasks": task.get("subtasks") or [],
        "source_page": task.get("source_page"),
        "has_solution": not task.get("solution", {}).get("missing", False),
    }


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class EvaluateRequest(BaseModel):
    task_id: str
    answer: str = Field(..., description="Antwort der/s Lernenden")


class EvaluateResponse(BaseModel):
    verdict: str  # "correct" | "partially_correct" | "incorrect" | "unclear"
    score: int  # 0..100
    feedback: str
    missing_points: list[str] = []
    correct_points: list[str] = []


class HintRequest(BaseModel):
    task_id: str
    level: int = Field(1, ge=1, le=3, description="1 = kleiner Schubs, 3 = fast die L\u00f6sung")
    previous_answer: str | None = None


class HintResponse(BaseModel):
    hint: str
    level: int


# ---------------------------------------------------------------------------
# Claude-Aufrufe
# ---------------------------------------------------------------------------
def _ask_claude_json(prompt: str, max_tokens: int = 800) -> dict[str, Any]:
    response = client.messages.create(
        model=MODEL_EVAL,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise HTTPException(
            status_code=502,
            detail=f"Antwort der KI ist kein JSON: {text[:300]}",
        )
    return json.loads(text[start : end + 1])


def _ask_claude_text(prompt: str, max_tokens: int = 400) -> str:
    response = client.messages.create(
        model=MODEL_EVAL,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in response.content if b.type == "text").strip()


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@app.get("/api/tasks")
def list_tasks() -> dict[str, Any]:
    topics = sorted({t.get("topic") or "Sonstiges" for t in TASKS})
    return {
        "count": len(TASKS),
        "topics": topics,
        "tasks": [_public_task(t) for t in TASKS],
    }


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str) -> dict[str, Any]:
    task = TASKS_BY_ID.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Aufgabe nicht gefunden.")
    return _public_task(task)


@app.get("/api/solution/{task_id}")
def get_solution(task_id: str) -> dict[str, Any]:
    task = TASKS_BY_ID.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Aufgabe nicht gefunden.")
    solution = task.get("solution") or {}
    if solution.get("missing"):
        raise HTTPException(
            status_code=404,
            detail="F\u00fcr diese Aufgabe ist keine Musterl\u00f6sung extrahiert.",
        )
    return {
        "task_id": task_id,
        "answer": solution.get("answer", ""),
        "key_points": solution.get("key_points", []),
        "final_result": solution.get("final_result", ""),
    }


@app.post("/api/evaluate", response_model=EvaluateResponse)
def evaluate(req: EvaluateRequest) -> EvaluateResponse:
    task = TASKS_BY_ID.get(req.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Aufgabe nicht gefunden.")
    solution = task.get("solution") or {}
    if solution.get("missing"):
        raise HTTPException(
            status_code=400,
            detail="F\u00fcr diese Aufgabe gibt es keine Musterl\u00f6sung \u2014 KI-Bewertung nicht m\u00f6glich.",
        )

    prompt = f"""Du bist eine erfahrene Chemielehrkraft und bewertest die Antwort einer Sch\u00fclerin der gymnasialen Oberstufe.

AUFGABE:
{task.get("question", "")}

{(f"GEGEBEN: {task.get('given')}" if task.get('given') else "").strip()}

MUSTERLOESUNG:
{solution.get("answer", "")}

WICHTIGE KERNPUNKTE (die in einer korrekten Antwort vorkommen sollten):
{json.dumps(solution.get("key_points", []), ensure_ascii=False)}

ENDERGEBNIS (falls vorhanden): {solution.get("final_result", "")}

ANTWORT DER SCHUELERIN:
\"\"\"{req.answer}\"\"\"

Bewerte fachlich. Sei wohlwollend bei Formulierungs- und Notationsunterschieden (z.B. $H^+$ vs. $H_3O^+$, Komma vs. Punkt als Dezimaltrenner, gerundete Zwischenergebnisse). Sei aber streng bei sachlich falschen Aussagen.

Gib AUSSCHLIESSLICH JSON in folgendem Schema zur\u00fcck:
{{
  "verdict": "correct" | "partially_correct" | "incorrect" | "unclear",
  "score": <Ganzzahl 0\u2013100>,
  "feedback": "<2\u20135 S\u00e4tze konstruktive R\u00fcckmeldung auf Deutsch, mit LaTeX-Formeln in $...$>",
  "correct_points": ["<richtig erkannte Aspekte>"],
  "missing_points": ["<noch fehlende/falsche Aspekte>"]
}}"""

    data = _ask_claude_json(prompt, max_tokens=1000)
    return EvaluateResponse(
        verdict=str(data.get("verdict", "unclear")),
        score=int(data.get("score", 0)),
        feedback=str(data.get("feedback", "")),
        correct_points=list(data.get("correct_points") or []),
        missing_points=list(data.get("missing_points") or []),
    )


@app.post("/api/hint", response_model=HintResponse)
def hint(req: HintRequest) -> HintResponse:
    task = TASKS_BY_ID.get(req.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Aufgabe nicht gefunden.")
    solution = task.get("solution") or {}

    level_instructions = {
        1: "Gib einen sehr kleinen Hinweis: nenne nur das relevante Konzept / die Formel / das Stichwort, das gebraucht wird. KEINE Rechnung, KEIN Ergebnis.",
        2: "Gib einen mittleren Hinweis: skizziere den ersten Schritt oder erkl\u00e4re, wie man anf\u00e4ngt. KEIN Endergebnis.",
        3: "Gib einen starken Hinweis: erkl\u00e4re den Rechen- bzw. Argumentationsweg in Stichpunkten, aber halte das Endergebnis zur\u00fcck oder verschleiere es leicht (z.B. \\\"\u2026 ergibt sich ein pH-Wert im sauren Bereich\\\").",
    }

    prompt = f"""Du bist eine Chemielehrkraft und gibst einer Sch\u00fclerin (Oberstufe) einen Lerntipp \u2014 OHNE die L\u00f6sung komplett zu verraten.

AUFGABE:
{task.get("question", "")}

{(f"GEGEBEN: {task.get('given')}" if task.get('given') else "").strip()}

MUSTERLOESUNG (NUR zur internen Orientierung, NICHT direkt wiedergeben):
{solution.get("answer", "(keine vorhanden)")}

KERNPUNKTE:
{json.dumps(solution.get("key_points", []), ensure_ascii=False)}

BISHERIGER VERSUCH DER SCH\u00dcLERIN (falls vorhanden):
{req.previous_answer or "(noch nichts geschrieben)"}

HINWEIS-LEVEL: {req.level}
{level_instructions.get(req.level, level_instructions[1])}

Antworte in 1\u20133 S\u00e4tzen auf Deutsch. Verwende LaTeX f\u00fcr Formeln (z.B. $K_a$, $pH = -\\\\log[H_3O^+]$). Nur Flie\u00dftext, kein JSON, kein Markdown-Codeblock."""

    text = _ask_claude_text(prompt, max_tokens=400)
    return HintResponse(hint=text, level=req.level)


# ---------------------------------------------------------------------------
# Static / Frontend
# ---------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
