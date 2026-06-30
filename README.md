# Chemie-Lern-App: Säuren & Basen

Eine kleine Lern-Web-App, die Aufgaben aus dem PDF *Übungsblätter Säuren und Basen* abfragt und Antworten mit Hilfe der **Claude-KI** (Anthropic) bewertet. Die App läuft entweder

- **rein statisch** im Browser (z. B. auf GitHub Pages), oder
- **lokal** mit einem kleinen FastAPI-Server (Key bleibt auf dem Rechner).

## Funktionen

- Aufgabenliste mit Themen-Filter und Suche
- LaTeX-Rendering für chemische Formeln (`$H_3O^+$`)
- Drei abgestufte **Tipps**, ohne die Lösung sofort zu verraten
- Anzeige der **Musterlösung** auf Anforderung
- **KI-gestützte Bewertung** der eigenen Antwort (Score 0–100 + Feedback)
- Fortschritt + Antworten werden lokal im Browser gespeichert
- Mobile / iPad / Desktop optimiert, helles und dunkles Theme

## Ordner-Struktur

```
.
├─ Übungsblätter Säuren und Basen.pdf
├─ Lösungen SäureBase.pdf
├─ scripts/
│  └─ extract_pdfs.py          OCR via Claude Vision → exercises.json
├─ data/                       Zwischenergebnisse (gerendert + Cache)
│  ├─ pages/                   PNG/JPG der PDF-Seiten
│  ├─ extracted_raw/           rohe Modell-Antworten je Seite (Cache)
│  └─ exercises.json           kombinierte Aufgaben + Lösungen
├─ docs/                       statische Web-App (für GitHub Pages)
│  ├─ index.html, app.js, style.css, manifest.webmanifest, icon.svg
│  └─ data/exercises.json      Kopie für die Web-App
├─ webapp/                     OPTIONAL: lokaler FastAPI-Server
└─ .github/workflows/pages.yml GitHub-Pages-Auto-Deployment
```

## 1) Aufgaben aus PDF extrahieren (einmalig)

Voraussetzung: Python 3.12 (per `winget install Python.Python.3.12`).

```powershell
# Venv anlegen und Pakete installieren
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --only-binary=:all: `
    pypdfium2 pillow fastapi anthropic python-dotenv jinja2 uvicorn

# API-Key in .env eintragen
copy .env.example .env
# Datei .env öffnen und ANTHROPIC_API_KEY=sk-ant-... ergänzen

# OCR + Strukturierung
$env:PYTHONIOENCODING="utf-8"
.\.venv\Scripts\python.exe scripts\extract_pdfs.py
```

Das Skript ist **inkrementell**: bereits an Claude gesendete Seiten liegen im
Cache (`data/extracted_raw/`) und werden beim erneuten Aufruf übersprungen.

Erzeugt: `data/exercises.json` **und** `docs/data/exercises.json`.

## 2a) Veröffentlichen auf GitHub Pages

1. Neues GitHub-Repo anlegen und den Inhalt dieses Ordners pushen
   (einschließlich `docs/data/exercises.json`).
2. Auf GitHub: **Settings → Pages**:
   - *Source*: **GitHub Actions** auswählen.
3. Der mitgelieferte Workflow `.github/workflows/pages.yml` deployt
   automatisch den Inhalt von `docs/` bei jedem Push auf `main`.
4. Nach wenigen Minuten ist die Seite erreichbar unter
   `https://<dein-user>.github.io/<repo-name>/`.

Alternativ (klassisch ohne Actions): in *Settings → Pages*
**Branch: `main` / Folder: `/docs`** auswählen.

### Erster Aufruf der Live-Seite

- Beim ersten Öffnen erscheint ein Einstellungs-Dialog → **Anthropic-API-Key** eintragen.
- Der Key wird **ausschließlich im `localStorage` Deines Browsers** gespeichert
  und direkt an Anthropic geschickt. Er liegt **nie** im Repo oder auf GitHub.
- Jede Nutzerin braucht ihren eigenen Key (kostenlos bei
  <https://console.anthropic.com/> registrierbar; eine Bewertung kostet wenige
  Promille Cent).
- Über das Zahnrad oben rechts lässt sich das Modell wechseln
  (Sonnet/Opus/Haiku), der Fortschritt zurücksetzen oder ausblenden.

### Sicherheit / Datenschutz

- Der Key liegt nur im Browser der jeweiligen Person.
- Anthropic erlaubt direkten Browser-Zugriff über den Header
  `anthropic-dangerous-direct-browser-access`. CORS ist serverseitig aktiv.
- Wer die Seite veröffentlicht, gibt damit auch die **Musterlösungen** (in
  `exercises.json`) frei. Für eine persönliche Lern-Seite ist das in Ordnung;
  falls Du das nicht möchtest, das Repo *privat* halten (private Repos können
  trotzdem GitHub Pages nutzen, allerdings nur in bezahlten Plänen) oder die
  Lösungen weglassen.

## 2b) Lokal mit FastAPI-Server starten (Alternative)

Falls Du den Key serverseitig halten und keine GitHub-Pages-Veröffentlichung
brauchst:

```powershell
.\.venv\Scripts\python.exe -m uvicorn webapp.app:app --reload
# → http://127.0.0.1:8000
```

## 2c) Statisch lokal testen (vor dem Pushen)

```powershell
cd docs
..\.venv\Scripts\python.exe -m http.server 8000
# → http://127.0.0.1:8000
```

(Direktes Doppelklicken von `index.html` funktioniert nicht — Browser
blockieren `fetch()` auf `file://`.)

## Bedienung der Web-App

- **Linke Spalte / Drawer**: Aufgabenliste (auf Mobilgeräten per Menü-Symbol).
- Pfeiltasten **←/→** oder Wisch-Geste am linken Rand zum Navigieren.
- **Antwort-Feld**: LaTeX in `$…$` für Formeln. **Strg+Enter** = Prüfen.
- **Tipp 1/2/3**: drei abgestufte Hilfen, ohne die Lösung zu verraten.
- **Musterlösung**: vollständige Lösung anzeigen (mit Bestätigung).
- **Zahnrad** (oben rechts): API-Key, Modell, Fortschritt.

## Kosten

- OCR ist eine Einmal-Aktion (~20 Seiten → wenige Cent).
- Jede KI-Bewertung kostet wenige Promille Cent (kurze Prompts).
