/**
 * Tool registration barrel file.
 *
 * Imports all 12 tool registration functions and provides a single
 * entry point to register them all on the MCP server.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerWidgetResources } from '../widgets.js';

import { registerBezirkeTool } from './bezirke.js';
import { registerBundesgesetzblattTool } from './bundesgesetzblatt.js';
import { registerBundesrechtTool } from './bundesrecht.js';
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
 * Register all 12 RIS tools and the widget resources they reference.
 */
export function registerAllTools(server: McpServer): void {
  registerWidgetResources(server);

  registerBundesrechtTool(server);
  registerLandesrechtTool(server);
  registerJudikaturTool(server);
  registerBundesgesetzblattTool(server);
  registerLandesgesetzblattTool(server);
  registerRegierungsvorlagenTool(server);
  registerDokumentTool(server);
  registerBezirkeTool(server);
  registerGemeindenTool(server);
  registerSonstigeTool(server);
  registerHistoryTool(server);
  registerVerordnungenTool(server);
}
