/**
 * MCP server config JSON import.
 *
 * Recognizes the `{"mcpServers": {...}}` shape used by Claude Desktop, Cursor,
 * VS Code, Windsurf, etc. Only HTTP-transport entries (a "url" field) can be
 * applied to the block — Phase 1 has no stdio transport, so a "command"-based
 * (local process) entry is reported back as unsupported instead of silently
 * dropped.
 */

export interface McpImportConfig {
  serverName?: string;
  url: string;
  headers: [string, string][];
  /** Other server entries present in the same pasted config, ignored (only one URL field exists). */
  extraCount: number;
}

export interface McpImportUnsupported {
  unsupported: true;
  reason: string;
}

export function parseMcpConfigJson(text: string): McpImportConfig | McpImportUnsupported | null {
  const trimmed = text.trim();
  // Cheap fingerprint check before paying for JSON.parse on every paste.
  if (!trimmed.startsWith('{') || !trimmed.includes('mcpServers')) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const servers = parsed?.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return null;

  const entries = Object.entries(servers);
  if (entries.length === 0) return null;

  const [serverName, def] = entries[0] as [string, any];
  if (!def || typeof def !== 'object') return null;

  const extraCount = entries.length - 1;

  if (typeof def.url === 'string' && def.url.trim()) {
    const headers: [string, string][] = [];
    if (def.headers && typeof def.headers === 'object' && !Array.isArray(def.headers)) {
      for (const [key, value] of Object.entries(def.headers)) {
        if (key) headers.push([key, String(value ?? '')]);
      }
    }
    return { serverName, url: def.url.trim(), headers, extraCount };
  }

  if (typeof def.command === 'string' && def.command.trim()) {
    return {
      unsupported: true,
      reason: `"${serverName}" is a local (stdio) MCP server — command: "${def.command}". The MCP block currently only supports Streamable-HTTP servers with a "url" field, not locally spawned commands.`,
    };
  }

  return null;
}
