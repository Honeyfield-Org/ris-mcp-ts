# DECISIONS

## Aktiv

- SDK bleibt auf der v1-Linie (`@modelcontextprotocol/sdk` ≥ 1.30.0); v2-/2026-07-28-Migration vertagt auf Neubewertung Q4 2026 — kein Client-Druck, kein Feature-Bedarf, v1-Security-Support läuft bis ~Ende Januar 2027.
- Öffentliche Endpoint-URL wird im Repo nicht dokumentiert (auch nicht in `server.json`) — Repo ist public, Gateway-URL bleibt unveröffentlicht.
- Tool-Fehler tragen `isError: true` (spec-konform); die deutsche Fehler-Prosa bleibt als Text erhalten — Clients/LLMs können Fehler programmatisch erkennen. Leere Suchergebnisse sind keine Fehler.
- Completions (`completion/complete`) werden nicht angeboten — die Spec erlaubt sie nur für Prompts/Resource-Templates, nicht für Tool-Argumente; unsere Enum-Werte stehen bereits im `inputSchema`.
- `structuredContent` spiegelt das vollständige geparste Suchergebnis und unterliegt nicht dem 25k-Zeichen-Limit des Text-Blocks — Synchronität mit `total_hits`/`page_size` geht vor Payload-Größe; die Größe steuert der Client über `limit` (max. 100 ist Opt-in).
- `ris_dokument` deklariert bewusst KEIN `outputSchema`/`structuredContent` (nur Text + `resource_link`) — Clients dürfen laut Spec annehmen, dass der Text-Block nur eine Serialisierung des `structuredContent` ist, und rendern dann nur Letzteres; der Volltext darf nie hinter Metadaten verschwinden (Live-Befund v1.3.0).
- Das `outputSchema` der Suchtools übernimmt die Pagination-Werte ohne Zod-Bounds — fehlerhafte Upstream-Werte bleiben inspizierbare Daten statt zum harten Protokollfehler zu werden.
- MCP-Cancellation (`extra.signal`) wird bis zum RIS-Fetch durchgereicht (`AbortSignal.any` mit dem 30s-Timeout); ein Caller-Abort propagiert als Abort (SDK verwirft die Response), nur echte Upstream-Fehler werden zur `isError`-Response. Dafür wurde `engines` seinerzeit auf Node ≥ 20.3 angehoben (`AbortSignal.any`); heutiger Floor siehe eigener Eintrag.
- MCP Apps werden umgesetzt — Trefferlisten-Widget (v1.4.0), dann Dokument-Viewer (v1.5.0) — über die offizielle `@modelcontextprotocol/ext-apps`-Extension auf der SDK-v1-Linie, komplett geplant und gestuft released, mit Rendering-Spike als hartem Gate und vollständigem Text-Fallback als Pflichtpfad — weil claude-ai-mcp#165 (Custom-Connector-Rendering flaky) offen ist und ein nicht-renderndes Widget nie Datenverlust bedeuten darf (Stand 2026-08-01).
- `_meta.ui.domain` wird nicht gesetzt — Weglassen ist verifiziert sicher, ein falsch berechneter Wert killt das Rendering zu 100 %, und die RIS-API ist CORS-offen.
- Widget-HTML wird als generierte String-Konstante ausgeliefert (Vite singlefile → `src/generated/`, gitignored, via `pre`-Scripts) statt per Laufzeit-`readFileSync` — eliminiert Pfadauflösung über npm/Docker/Dev als Fehlerquelle.
- Node-Floor `engines` ≥ 20.19 — vite 7 (Widget-Build) verlangt es; löst den früheren 20.3-Floor aus der Cancellation-Arbeit ab.
- Mit der ersten registrierten Resource schaltet sich die `resources`-Capability im Initialize-Handshake ein — bewusst in Kauf genommen, weil Nicht-UI-Clients die Capability ignorieren und der Text-Pfad aller 12 Tools unverändert bleibt.
- Die Widget-CSP wird mit explizit leeren Arrays (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`) an der **Resource** deklariert, nicht am Tool — `McpUiToolMeta.csp` ist in den ext-apps-Typings `never` (Hosts lesen die CSP aus `resources/read`, Fallback `resources/list`), und eine fehlende Deklaration erscheint im Host als "CSP aus" statt als "braucht nichts" (Befund Rendering-Gate #45). Die leeren Arrays setzen voraus, dass das Bundle self-contained bleibt — `ui-template.test.ts` hält das fest.
- Alle 12 Tools tragen `destructiveHint: false`, obwohl die Annotation bei `readOnlyHint: true` spec-redundant ist — OpenAI listet sie als Pflicht-Annotation für App-Submissions; nicht als Rauschen wegkürzen.

## Offen

- Elicitation (SDK v2) als Kandidat für den Auth-/Paywall-Flow aus Issue #24 — entscheidet den v2-Migrationszeitpunkt mit.

## Verworfen

- Sofortige Migration auf SDK v2 (Stand 2026-07-31) — vier Tage nach GA ohne Patch-Releases, kein heutiger Client spricht die 2026er-Ära, kein benötigtes Feature.
- Metadaten-`structuredContent` auf `ris_dokument` (v1.3.0, Slice 3) — Clients, die `structuredContent` bevorzugen, verwarfen den Text-Block und damit den Dokumenttext; als Hotfix zurückgebaut.
- mcp-ui (`@mcp-ui/server`) als UI-SDK (Stand 2026-08-01) — nur noch ein veralteter Wrapper um `ext-apps` (kein Release seit Feb 2026, Remote-DOM entfernt), die Maintainer empfehlen selbst den Direktweg über die offizielle Extension.
- History-Timeline als Widget-Use-Case (Stand 2026-08-01) — `ris_history` ist ein Change-Feed pro Applikation ohne Dokumentnummer-Parameter; die Daten für eine Norm-Fassungs-Timeline existieren in der RIS-History-API nicht.
