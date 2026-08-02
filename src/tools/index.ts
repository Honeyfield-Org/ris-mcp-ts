/**
 * Tool registration barrel file.
 *
 * Imports all 13 tool registration functions and provides a single
 * entry point to register them all on the MCP server.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createDocumentCache } from '../document-cache.js';
import { registerWidgetResources } from '../widgets.js';

import { registerBezirkeTool } from './bezirke.js';
import { registerBundesgesetzblattTool } from './bundesgesetzblatt.js';
import { registerBundesrechtTool } from './bundesrecht.js';
import { registerDokumentAbschnittTool } from './dokument-abschnitt.js';
import { registerDokumentTool } from './dokument.js';
import { registerGemeindenTool } from './gemeinden.js';
import { registerHistoryTool } from './history.js';
import { registerJudikaturTool } from './judikatur.js';
import { registerLandesgesetzblattTool } from './landesgesetzblatt.js';
import { registerLandesrechtTool } from './landesrecht.js';
import { registerRegierungsvorlagenTool } from './regierungsvorlagen.js';
import { registerSonstigeTool } from './sonstige.js';
import { registerVerordnungenTool } from './verordnungen.js';

/**
 * Register all 13 RIS tools and the widget resources they reference.
 *
 * The document cache is a closure over this call, which gives it the lifetime of
 * the server it belongs to: one per session on HTTP, where `http.ts` builds a
 * fresh `McpServer` per session, and one per process on stdio, where `server.ts`
 * builds exactly one. `ris_dokument` fills it and `ris_dokument_abschnitt` pages
 * through what it holds.
 */
export function registerAllTools(server: McpServer): void {
  const documentCache = createDocumentCache();

  registerWidgetResources(server);

  registerBundesrechtTool(server);
  registerLandesrechtTool(server);
  registerJudikaturTool(server);
  registerBundesgesetzblattTool(server);
  registerLandesgesetzblattTool(server);
  registerRegierungsvorlagenTool(server);
  registerDokumentTool(server, documentCache);
  registerDokumentAbschnittTool(server, documentCache);
  registerBezirkeTool(server);
  registerGemeindenTool(server);
  registerSonstigeTool(server);
  registerHistoryTool(server);
  registerVerordnungenTool(server);
}
