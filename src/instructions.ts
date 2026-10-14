/**
 * Server-level instructions, sent to every client in the `initialize` result.
 *
 * Hosts that honour them (Claude, LibreChat with `serverInstructions: true`,
 * Claude Code) put them in front of the model once per conversation, so they are
 * the one place that tells a model *which* of the 13 tools to reach for and how
 * to treat the answer. The cost is paid on every conversation, in tokens — keep
 * this short, and name only tools and parameters that exist: the e2e test
 * checks every `ris_*` name here against `tools/list`.
 *
 * Deliberately not mentioned: `ris_dokument_abschnitt`. It is the document
 * viewer's chunk tool and describes itself as such; pointing a model at it would
 * invite exactly the direct use its description discourages.
 */
export const SERVER_INSTRUCTIONS = `Austrian legal research via the official RIS (Rechtsinformationssystem, data.bka.gv.at).

Workflow: search with the matching ris_* tool, then load the full text of a hit with ris_dokument (dokumentnummer from the hit).
- Laws: ris_bundesrecht (federal; \`paragraph\` for a single §, \`fassung_vom\` for the version in force on a date), ris_landesrecht (states; \`bundesland\`), ris_bundesgesetzblatt / ris_landesgesetzblatt (gazettes).
- Case law: ris_judikatur (\`gerichtsbarkeit\`, \`norm\`, \`geschaeftszahl\`).
- Other: ris_regierungsvorlagen (bills), ris_bezirke, ris_gemeinden, ris_sonstige, ris_verordnungen; ris_history for the change history of a document.

Rules:
- Results are paged (\`seite\`, \`limit\`). Prefer limit 10-20 and a narrower search over paging through many pages.
- Long documents are cut off ("Antwort gekuerzt"). Say so and point the user to the RIS link instead of guessing the missing text.
- Quote only what a tool returned. Cite the Dokumentnummer or Geschaeftszahl and the RIS link.
- Answer in the user's language (usually German). This is legal information, not legal advice.`;
