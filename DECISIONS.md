# DECISIONS

## Aktiv

- SDK bleibt auf der v1-Linie (`@modelcontextprotocol/sdk` ≥ 1.30.0); v2-/2026-07-28-Migration vertagt auf Neubewertung Q4 2026 — kein Client-Druck, kein Feature-Bedarf, v1-Security-Support läuft bis ~Ende Januar 2027.
- Öffentliche Endpoint-URL wird im Repo nicht dokumentiert (auch nicht in `server.json`) — Repo ist public, Gateway-URL bleibt unveröffentlicht.
- Tool-Fehler tragen `isError: true` (spec-konform); die deutsche Fehler-Prosa bleibt als Text erhalten — Clients/LLMs können Fehler programmatisch erkennen. Leere Suchergebnisse sind keine Fehler.
- Completions (`completion/complete`) werden nicht angeboten — die Spec erlaubt sie nur für Prompts/Resource-Templates, nicht für Tool-Argumente; unsere Enum-Werte stehen bereits im `inputSchema`.
- `structuredContent` spiegelt das vollständige geparste Suchergebnis und unterliegt nicht dem 25k-Zeichen-Limit des Text-Blocks — Synchronität mit `total_hits`/`page_size` geht vor Payload-Größe; die Größe steuert der Client über `limit` (max. 100 ist Opt-in). Volltexte (`ris_dokument`) bleiben nur im Text-Block, strukturiert gibt es Metadaten + `resource_link` aufs Original.
- Das `outputSchema` der Suchtools übernimmt die Pagination-Werte ohne Zod-Bounds — fehlerhafte Upstream-Werte bleiben inspizierbare Daten statt zum harten Protokollfehler zu werden.
- MCP-Cancellation (`extra.signal`) wird bis zum RIS-Fetch durchgereicht (`AbortSignal.any` mit dem 30s-Timeout); ein Caller-Abort propagiert als Abort (SDK verwirft die Response), nur echte Upstream-Fehler werden zur `isError`-Response. Dafür `engines` auf Node ≥ 20.3 angehoben (`AbortSignal.any`).

## Offen

- Elicitation (SDK v2) als Kandidat für den Auth-/Paywall-Flow aus Issue #24 — entscheidet den v2-Migrationszeitpunkt mit.

## Verworfen

- Sofortige Migration auf SDK v2 (Stand 2026-07-31) — vier Tage nach GA ohne Patch-Releases, kein heutiger Client spricht die 2026er-Ära, kein benötigtes Feature.
