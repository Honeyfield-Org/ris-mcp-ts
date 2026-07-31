# DECISIONS

## Aktiv

- SDK bleibt auf der v1-Linie (`@modelcontextprotocol/sdk` ≥ 1.30.0); v2-/2026-07-28-Migration vertagt auf Neubewertung Q4 2026 — kein Client-Druck, kein Feature-Bedarf, v1-Security-Support läuft bis ~Ende Januar 2027.
- Öffentliche Endpoint-URL wird im Repo nicht dokumentiert (auch nicht in `server.json`) — Repo ist public, Gateway-URL bleibt unveröffentlicht.

## Offen

- Elicitation (SDK v2) als Kandidat für den Auth-/Paywall-Flow aus Issue #24 — entscheidet den v2-Migrationszeitpunkt mit.
- `isError: true` bei Fehler-Responses (Horizont 2) — Contract-Änderung gegenüber bestehenden Clients, vor Umsetzung prüfen.

## Verworfen

- Sofortige Migration auf SDK v2 (Stand 2026-07-31) — vier Tage nach GA ohne Patch-Releases, kein heutiger Client spricht die 2026er-Ära, kein benötigtes Feature.
