/**
 * MCP Server for the Austrian RIS (Rechtsinformationssystem).
 *
 * This module provides an MCP server with tools for searching and retrieving
 * Austrian legal documents including federal laws, state laws, and court decisions.
 *
 * API Documentation: https://data.bka.gv.at/ris/api/v2.6/
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAllTools } from './tools/index.js';
import { VERSION } from './version.js';

export const server = new McpServer({
  name: 'ris-mcp',
  version: VERSION,
});

registerAllTools(server);
