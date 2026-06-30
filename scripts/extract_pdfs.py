r"""Rasterisiert die PDFs zu JPEG-Seiten und nutzt anschlie\u00dfend Claude Vision,
um Aufgaben und L\u00f6sungen als strukturierte JSON zu extrahieren.

Aufruf:
    .\.venv\Scripts\python.exe scripts/extract_pdfs.py

Erzeugt:
    data/pages/uebungen_p{n}.jpg            (JPEG je Seite)
    data/pages/loesungen_p{n}.jpg
    data/extracted_raw/uebungen_p{n}.json   (rohe Modellantwort je Seite)
    data/extracted_raw/loesungen_p{n}.json
    data/exercises.json                     (final zusammengef\u00fchrt)
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

# Konsolen-Ausgabe als UTF-8, damit auch NFD-Umlaute (z.B. aus Dateinamen) gehen
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import pypdfium2 as pdfium
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

try:
    import anthropic
except ImportError as exc:  # pragma: no cover
    print("anthropic SDK fehlt:", exc)
    sys.exit(1)

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
if not API_KEY:
    print("FEHLER: ANTHROPIC_API_KEY ist leer. Bitte in .env eintragen.")
    sys.exit(1)

MODEL = os.environ.get("ANTHROPIC_MODEL_OCR", "claude-sonnet-4-5").strip()
client = anthropic.Anthropic(api_key=API_KEY)


def _find_pdf(*needles: str) -> Path | None:
    """Findet eine PDF unabh\u00e4ngig von Unicode-Normalisierung (NFC vs. NFD)."""
    import unicodedata

    def norm(s: str) -> str:
        return unicodedata.normalize("NFKD", s.lower())

    targets = [norm(n) for n in needles]
    for p in ROOT.glob("*.pdf"):
        name = norm(p.name)
        if any(t in name for t in targets):
            return p
    return None


PDF_UEBUNGEN = _find_pdf("\u00fcbungsbl", "uebungsbl")
PDF_LOESUNGEN = _find_pdf("l\u00f6sungen", "loesungen")

PAGES_DIR = ROOT / "data" / "pages"
RAW_DIR = ROOT / "data" / "extracted_raw"
OUT_FILE = ROOT / "data" / "exercises.json"
DOCS_OUT_FILE = ROOT / "docs" / "data" / "exercises.json"
PAGES_DIR.mkdir(parents=True, exist_ok=True)
RAW_DIR.mkdir(parents=True, exist_ok=True)
DOCS_OUT_FILE.parent.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Rasterisierung
# ---------------------------------------------------------------------------
MAX_BYTES = 4_500_000  # deutlich unter Claudes 10-MB-Limit (base64 erh\u00f6ht Volumen)
MAX_DIM = 1800  # max. Kantenl\u00e4nge in Pixel


def rasterize(pdf_path: Path, prefix: str, dpi: int = 150) -> list[Path]:
    pdf = pdfium.PdfDocument(str(pdf_path))
    scale = dpi / 72.0
    out: list[Path] = []
    for i, page in enumerate(pdf, start=1):
        target = PAGES_DIR / f"{prefix}_p{i:02d}.jpg"
        if target.exists() and target.stat().st_size <= MAX_BYTES:
            out.append(target)
            continue
        bitmap = page.render(scale=scale)
        pil_image = bitmap.to_pil().convert("L")
        # auf MAX_DIM runterskalieren, falls zu gro\u00df
        w, h = pil_image.size
        if max(w, h) > MAX_DIM:
            ratio = MAX_DIM / max(w, h)
            pil_image = pil_image.resize((int(w * ratio), int(h * ratio)))
        # Iterativ Qualit\u00e4t senken, bis die Datei klein genug ist
        quality = 85
        while True:
            pil_image.save(target, format="JPEG", quality=quality, optimize=True)
            if target.stat().st_size <= MAX_BYTES or quality <= 40:
                break
            quality -= 10
        out.append(target)
        print(f"  Seite {i}: {target.name} ({target.stat().st_size // 1024} KB, q={quality})")
    return out


# ---------------------------------------------------------------------------
# Claude Vision
# ---------------------------------------------------------------------------
PROMPT_UEBUNGEN = """Du extrahierst Aufgaben aus einer Seite eines Chemie-\u00dcbungsblatts (Thema S\u00e4uren und Basen, deutsche Oberstufe).

Gib AUSSCHLIESSLICH valides JSON zur\u00fcck. Schema:
{
  "page": <Seitennummer>,
  "tasks": [
    {
      "id": "<eindeutige Kennung, z.B. \\"A1\\" oder \\"A1a\\">",
      "number": "<Originalnummer wie auf dem Blatt, z.B. \\"Aufgabe 1\\" oder \\"1a)\\">",
      "topic": "<kurzes Stichwort, z.B. \\"pH-Wert\\", \\"Br\u00f8nsted\\", \\"Titration\\">",
      "type": "text | calculation | multi_part | mcq",
      "question": "<vollst\u00e4ndiger Aufgabentext, chemische Formeln in LaTeX, z.B. $H_2SO_4$, $K_a$, $pH = -\\\\log[H_3O^+]$>",
      "given": "<Falls Gr\u00f6\u00dfen gegeben sind: stichwortartig auflisten, sonst leer>",
      "expected_answer_kind": "freitext | zahl | formel | gleichung | tabelle",
      "subtasks": [ { "id": "1a", "question": "...", "expected_answer_kind": "..." } ]
    }
  ]
}

Regeln:
- Wenn die Seite KEINE Aufgaben enth\u00e4lt (z.B. Deckblatt, Tabellenanhang), gib {"page": <n>, "tasks": []} zur\u00fcck.
- Schreibe chemische Formeln und Gleichungen in LaTeX (mit $...$), z.B. $H_3O^+$, $CH_3COOH \\\\rightleftharpoons CH_3COO^- + H^+$.
- Behalte die Originalnummerierung bei. Wenn mehrere Teilaufgaben vorhanden sind, packe sie in "subtasks".
- KEIN Markdown-Codeblock, KEIN erkl\u00e4render Text \u2014 nur reines JSON."""

PROMPT_LOESUNGEN = """Du extrahierst Musterl\u00f6sungen aus einer Seite eines Chemie-L\u00f6sungsblatts (Thema S\u00e4uren und Basen, deutsche Oberstufe).

Gib AUSSCHLIESSLICH valides JSON zur\u00fcck. Schema:
{
  "page": <Seitennummer>,
  "solutions": [
    {
      "id": "<Aufgabenkennung, z.B. \\"A1\\" oder \\"A1a\\">",
      "number": "<Originalnummer auf dem Blatt, z.B. \\"Aufgabe 1\\" oder \\"1a)\\">",
      "answer": "<vollst\u00e4ndige Musterl\u00f6sung, Formeln in LaTeX $...$, ggf. mit Rechenweg>",
      "key_points": ["<wichtige Teilaspekte / Stichworte, anhand derer ein/e Lehrer/in bewerten w\u00fcrde>"],
      "final_result": "<Falls vorhanden: Endergebnis kompakt, z.B. \\"pH = 2,87\\" oder leer>"
    }
  ]
}

Regeln:
- Schreibe chemische Formeln und Gleichungen in LaTeX (mit $...$).
- "key_points" sollte 2\u20136 pr\u00e4gnante Aspekte enthalten, die in einer korrekten Antwort vorkommen m\u00fcssen.
- Wenn die Seite KEINE L\u00f6sungen enth\u00e4lt, gib {"page": <n>, "solutions": []} zur\u00fcck.
- KEIN Markdown-Codeblock, KEIN erkl\u00e4render Text \u2014 nur reines JSON."""


def call_claude(image_path: Path, prompt: str, page_number: int) -> dict[str, Any]:
    image_b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    media_type = "image/jpeg" if image_path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            response = client.messages.create(
                model=MODEL,
                max_tokens=4096,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": image_b64,
                                },
                            },
                            {
                                "type": "text",
                                "text": f"Seite {page_number}\n\n{prompt}",
                            },
                        ],
                    }
                ],
            )
            text = "".join(
                block.text for block in response.content if block.type == "text"
            ).strip()
            return parse_json_response(text, page_number)
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            wait = 2 ** attempt
            print(f"    Versuch {attempt + 1} fehlgeschlagen ({exc}). Warte {wait}s\u2026")
            time.sleep(wait)
    raise RuntimeError(f"Claude-Aufruf f\u00fcr Seite {page_number} fehlgeschlagen: {last_err}")


def parse_json_response(text: str, page_number: int) -> dict[str, Any]:
    # Entferne potentielle Codeblock-Marker
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Fallback: suche das erste { ... letzte }
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError as exc:
                raise RuntimeError(
                    f"Antwort f\u00fcr Seite {page_number} ist kein g\u00fcltiges JSON: {exc}\n{text[:500]}"
                )
        raise RuntimeError(
            f"Antwort f\u00fcr Seite {page_number} enth\u00e4lt kein JSON-Objekt:\n{text[:500]}"
        )


# ---------------------------------------------------------------------------
# Haupt-Pipeline
# ---------------------------------------------------------------------------
def process(pdf_path: Path, prefix: str, prompt: str) -> list[dict[str, Any]]:
    safe_name = unicodedata.normalize("NFC", pdf_path.name)
    print(f"\n=== {safe_name} ===")
    if not pdf_path.exists():
        print(f"  PDF fehlt: {safe_name}")
        return []
    print("Rasterisieren\u2026")
    images = rasterize(pdf_path, prefix)
    print(f"  {len(images)} Seite(n) bereit.")

    results: list[dict[str, Any]] = []
    for image in images:
        match = re.search(r"_p(\d+)\.(?:png|jpg|jpeg)$", image.name)
        page_number = int(match.group(1)) if match else 0
        cache = RAW_DIR / f"{image.stem}.json"
        if cache.exists():
            data = json.loads(cache.read_text(encoding="utf-8"))
            print(f"  Seite {page_number}: aus Cache geladen.")
        else:
            print(f"  Seite {page_number}: an Claude senden\u2026")
            data = call_claude(image, prompt, page_number)
            cache.write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        results.append(data)
    return results


def merge(uebungen: list[dict[str, Any]], loesungen: list[dict[str, Any]]) -> dict[str, Any]:
    tasks: list[dict[str, Any]] = []
    for page in uebungen:
        for task in page.get("tasks", []):
            task["source_page"] = page.get("page")
            tasks.append(task)

    solutions_by_id: dict[str, dict[str, Any]] = {}
    for page in loesungen:
        for sol in page.get("solutions", []):
            sol["source_page"] = page.get("page")
            sid = (sol.get("id") or "").strip()
            if sid:
                solutions_by_id[normalize_id(sid)] = sol

    # Ordnen: jeder Aufgabe ihre L\u00f6sung zuordnen
    for task in tasks:
        tid = normalize_id(task.get("id") or "")
        sol = solutions_by_id.get(tid)
        if sol is None:
            # Versuche Nummern-Match (z.B. "1a)" -> "1a")
            tnum = normalize_id(task.get("number") or "")
            for k, v in solutions_by_id.items():
                if normalize_id(v.get("number") or "") == tnum or k == tnum:
                    sol = v
                    break
        task["solution"] = sol or {
            "answer": "",
            "key_points": [],
            "final_result": "",
            "missing": True,
        }

    return {
        "tasks": tasks,
        "raw_solutions": list(solutions_by_id.values()),
    }


def normalize_id(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]", "", s).lower()


def main() -> int:
    uebungen = process(PDF_UEBUNGEN, "uebungen", PROMPT_UEBUNGEN)
    loesungen = process(PDF_LOESUNGEN, "loesungen", PROMPT_LOESUNGEN)
    merged = merge(uebungen, loesungen)
    payload = json.dumps(merged, ensure_ascii=False, indent=2)
    OUT_FILE.write_text(payload, encoding="utf-8")
    DOCS_OUT_FILE.write_text(payload, encoding="utf-8")
    n_with = sum(1 for t in merged["tasks"] if not t["solution"].get("missing"))
    print(
        f"\nFertig: {len(merged['tasks'])} Aufgaben, davon {n_with} mit L\u00f6sung. "
        f"\u2192 {OUT_FILE.relative_to(ROOT)} und {DOCS_OUT_FILE.relative_to(ROOT)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
