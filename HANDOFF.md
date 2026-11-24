# Handoff — Stand 2026-11-24

Arbeitsstand zu PR #117 (Self-Hosting, extern) und Issue #124 (`ogd.ris.bka.gv.at`).
Kurzlebig: nach Abschluss beider Punkte löschen. Dauerhafte Entscheidungen gehören
nach `DECISIONS.md`, Architektur nach `CLAUDE.md`.

## Erledigt

- **PR #117 reviewt** (daralph, „Self-Hosting für LibreChat und Claude“). Auf 1.9.0
  rebased, Merge konfliktfrei, `pnpm run check` lokal grün (1168 Server-Tests in
  27 Dateien, 436 UI-Tests). Host-Sim nicht gelaufen — der PR berührt die Widgets
  nicht.
- **Daralph hat #117 am 2026-11-18 selbst geschlossen**, ohne Kommentar und
  ungemergt. Seine letzte Nachricht (2026-10-30, Angebot zum Aufteilen) blieb
  19 Tage unbeantwortet.
- **Antwort an daralph gepostet** (2026-11-19, Kommentar auf #117): Bitte um
  Aufteilung (siehe Entscheidungen), Frage nach seinem Plan (Weiterbetrieb, Tiefe
  der LibreChat-Anbindung), Angebot, den Server-Teil selbst zu übernehmen und ihn
  als Co-Author zu nennen. Stand 2026-11-24: keine Antwort.
- **Issue #124 analysiert** (alfo-dev, 2026-11-18). Befund und Vorschlag unten.

## Entscheidungen

### PR #117 — aufteilen

| Teil                                                                                                                             | Entscheidung                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: `MCP_AUTH_TOKEN`, `MCP_STATELESS`, `RATE_LIMIT_PER_MINUTE`, CORS, `docker-compose.yml`, `.env.example`, `examples/librechat/` | übernehmen                                                                                                                                                                         |
| README                                                                                                                           | nur ein kurzer englischer Abschnitt „Self-Hosting“ (~40 statt 308 Zeilen); die deutsche Anleitung als eigene Datei `docs/self-hosting.de.md`                                       |
| SVG-Grafiken (`docs/assets/`, eigene Grünpalette)                                                                                | weglassen — nicht unsere Marke                                                                                                                                                     |
| `AGENTS.md`-Symlink                                                                                                              | weglassen — gehört zu daralphs eigenem Tooling                                                                                                                                     |
| B: Server-Instructions (`src/instructions.ts`)                                                                                   | eigener PR; vorher/nachher 5–10 typische Fragen in Claude Code prüfen (ruft das Modell öfter `ris_dokument`, nennt es Kürzungen?)                                                  |
| `.mcpb` (Claude-Desktop-Paket, Release-Asset)                                                                                    | zurückgestellt — nie in Claude Desktop installiert, Tool-Liste handgepflegt, zwei Beschreibungen falsch (`ris_verordnungen` = nur Tirol, nicht „der Länder“; Autor falsch gesetzt) |

Fallback, falls daralph nicht liefert: Teil A selbst übernehmen, daralph als
Co-Author.

### Issue #124 — Vorschlag, noch **nicht** entschieden

Nicht `ogd.ris.bka.gv.at` auf die Allowlist setzen, sondern den Host vor dem Abruf
auf `ris.bka.gv.at` umschreiben:

1. `normalizeRisUrl()` in `src/client.ts`: Host `ogd.ris.bka.gv.at` →
   `ris.bka.gv.at`, Pfad und Query unverändert.
2. `src/document-loader.ts` ruft sie **vor** beiden `isAllowedUrl()`-Prüfungen
   auf (Zeile 74: URL des Aufrufers; Zeile 185: URL aus dem Suchtreffer).
3. `ALLOWED_DOCUMENT_HOSTNAMES` bleibt unverändert — die Liste nennt nur Hosts,
   die wir wirklich abrufen.
4. Links in der Ausgabe (`**Quelle:**`, `structuredContent`, Widget) bleiben
   unverändert.
5. Test zuerst: je ein scheiternder Test für Fall 1 und Fall 2 (siehe Befund),
   dann der Fix.

## Offen

1. **#124: drei Entscheidungen des Maintainers**
   - Umschreiben nur beim Abruf (Empfehlung) oder auch in allen Ausgabe-Links
     (ändert die Ausgabe aller 11 Suchtools und den Snapshot-Test)?
   - Kurze Bestätigung an alfo-dev im Issue posten?
   - Als 1.9.1 releasen? Empfehlung: ja, weil der Dokumentnummer-Fallback heute
     kaputt ist.
2. **#117: auf daralph warten.** Bei Antwort: Teil A als eigenen PR annehmen.
   Ohne Antwort: Fallback (selbst übernehmen).
3. **Aufräumen:** Worktree `../ris-pr117` und Branch `pr-117` entfernen, sobald
   #117 entschieden ist (`git worktree remove ../ris-pr117 && git branch -D pr-117`).
4. Unberührt: #101, #102, #103 (Viewer/Perf, seit 2026-08-07 offen).

## Befund #124 (gemessen 2026-11-19)

- **Die RIS-API liefert selbst `ogd`-URLs:** in einer `BrKons`-Suche nach „ABGB“
  waren 60 von 70 URLs `https://ogd.ris.bka.gv.at/...` (html, xml, rtf, pdf). Der
  Parser reicht sie unverändert durch (`src/parser.ts`, `extractContentUrls`).
- **Fall 1 (im Issue):** ein Aufrufer übergibt eine `ogd`-URL an `ris_dokument` →
  abgelehnt (`document-loader.ts:74`). Trifft auch Modelle, die eine URL aus
  unseren eigenen Suchergebnissen kopieren.
- **Fall 2 (nicht im Issue):** nur `dokumentnummer` → direkte URL scheitert →
  Fallback-Suche → `content_urls.html` ist jetzt meist `ogd` → abgelehnt
  (`document-loader.ts:185`) mit „Die Inhalts-URL des Dokuments ist nicht
  erlaubt“. Der Fallback ist damit dort kaputt, wo er gebraucht wird.
- **`ogd.ris.bka.gv.at` antwortet curl mit 503 und einer Seite „Security
  Check“** (vermutlich WAF/Bot-Schutz). Freigeben ohne Umschreiben könnte diese
  Seite als Dokumenttext ausgeben. Ob der Schutz auch die Produktions-IP trifft,
  ist nicht gemessen.
- **Dieselben Pfade unter `ris.bka.gv.at` liefern 200:**
  `/Dokumente/Bundesnormen/…/….html`, `.xml` (`application/xml`), `.pdf`
  (`application/pdf`) und `/Dokument.wxe?Abfrage=Justiz&Dokumentnummer=…`
  (117 KB). Stichproben, kein Beweis für alle Dokumenttypen.

## Eigenheiten

- **Fork-PRs bekommen keine CI**, bis ein Maintainer die Workflows freigibt —
  `statusCheckRollup` ist dann leer. Vor einem Review lokal `pnpm run check`
  laufen lassen.
- **Daralphs Fork ist nicht mehr erreichbar** (GitHub-API 404). Die Commits
  bleiben über `git fetch origin pull/117/head:pr-117` abrufbar.
- **CORS-Teil von #117 hat in Produktion keine Wirkung:** der Produktions-Endpoint
  antwortet jeder Anfrage mit Browser-Origin (claude.ai, chatgpt.com, example.com)
  mit 403, `ALLOWED_ORIGINS` ist dort also leer oder ohne diese Origins
  (gemessen 2026-11-18). Ohne Eintrag feuert `applyCors()` nie.
- **Größe der Server-Instructions:** 1.095 Zeichen gegen 79.083 Zeichen
  `tools/list` (davon 9.133 Zeichen Beschreibungen), also ~1,4 % mehr. Neu sind
  daran nur der Ablauf „suchen → `ris_dokument`“ (keine Suchtool-Beschreibung
  verweist darauf), die Kürzungsregel und die Zitierregel. Der Hinweis „keine
  Rechtsberatung“ steht schon in allen 13 Tool-Beschreibungen. Welche Hosts die
  Instructions ans Modell geben, ist nur für Claude Code bekannt.
- **Den Bot-Schutz von `ogd` nicht mit gefälschtem Browser-User-Agent testen.**
  Der Auto-Mode-Classifier blockiert das zu Recht als Umgehung eines
  Sicherheitsmechanismus.
