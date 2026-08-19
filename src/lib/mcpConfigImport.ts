/**
 * MCP server config JSON import.
 *
 * Recognizes both `{"mcpServers": {...}}` (Claude Desktop, Cursor, Windsurf,
 * Claude Code's .mcp.json, etc.) and `{"servers": {...}}` (VS Code's
 * .vscode/mcp.json) — same per-entry shape, different container key. Every
 * entry in the pasted config is parsed, not just the first — a config with
 * several servers produces one result per server, applied as one block each
 * (see applyMcpImport.ts). Only HTTP-transport entries can become a real
 * block (the mcp-connection block has no stdio/local-process transport) — a
 * "command"-based entry is reported back as unsupported instead of silently
 * dropped, unless it's actually `mcp-remote` (below), which isn't a local
 * server at all.
 */

export interface McpImportConfig {
  serverName?: string;
  url: string;
  headers: [string, string][];
}

export interface McpImportUnsupported {
  unsupported: true;
  serverName?: string;
  reason: string;
}

export type McpImportEntry = McpImportConfig | McpImportUnsupported;

export interface McpImportResult {
  entries: McpImportEntry[];
}

export function isUnsupported(entry: McpImportEntry): entry is McpImportUnsupported {
  return 'unsupported' in entry;
}

/** Accepts every header shape actually seen in the wild: a plain object map
 *  (`{"Name": "value"}`, most common), or an array of `{name, value}` /
 *  `{key, value}` objects (some tools represent headers this way to
 *  preserve duplicate names / explicit ordering). Anything else is treated
 *  as no headers rather than thrown away with an error — a config that's
 *  otherwise valid shouldn't fail to import over a headers field Voiden
 *  doesn't recognize the shape of. */
function parseHeaders(raw: unknown): [string, string][] {
  const headers: [string, string][] = [];
  if (!raw) return headers;

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const key = (entry as any).name ?? (entry as any).key;
      const value = (entry as any).value;
      if (key) headers.push([String(key), String(value ?? '')]);
    }
    return headers;
  }

  if (typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key) headers.push([key, String(value ?? '')]);
    }
  }
  return headers;
}

/**
 * `npx -y mcp-remote <url> [--header "Name: value"]...` (or the package
 * invoked directly as `command: "mcp-remote"`, no npx wrapper) isn't a local
 * MCP server — it's a stdio↔HTTP bridge, purely so stdio-only clients (e.g.
 * Claude Desktop's config format, which has no HTTP transport at all) can
 * reach a server that's actually remote. The real url/headers are sitting
 * right there in its `args`, so this unwraps it into the exact same shape a
 * native `"url"` entry produces — no process-spawning needed, because
 * nothing about the actual server is local in the first place.
 *
 * `--header` may repeat; each value is `"Name: value"` (first colon splits
 * name from value, matching how mcp-remote itself parses it).
 */
const isMcpRemoteName = (s: string) => /(^|[\\/])mcp-remote$/i.test(s.trim())

function parseMcpRemoteArgs(command: string, args: unknown): { url: string; headers: [string, string][] } | null {
  if (!Array.isArray(args)) return null
  const tokens = args.map(String)
  // Two real invocation shapes: `command: "mcp-remote"` directly (its own
  // args follow as-is), or wrapped — most commonly `npx -y mcp-remote ...`,
  // but any wrapper works as long as "mcp-remote" appears somewhere in args
  // (everything before it, e.g. "-y", is that wrapper's own flags, not ours).
  const remoteIdx = tokens.findIndex(isMcpRemoteName)
  if (!isMcpRemoteName(command) && remoteIdx === -1) return null

  const rest = isMcpRemoteName(command) ? tokens : tokens.slice(remoteIdx + 1)
  const headers: [string, string][] = []
  let url: string | undefined

  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]
    if (tok === '--header' || tok === '-H') {
      const raw = rest[++i]
      if (raw) {
        const sep = raw.indexOf(':')
        if (sep !== -1) headers.push([raw.slice(0, sep).trim(), raw.slice(sep + 1).trim()])
      }
      continue
    }
    if (tok.startsWith('--')) {
      // Every other mcp-remote flag (--transport, --allow-http, etc.) either
      // takes no value or isn't representable on the block — skip the flag
      // itself; a same-shaped value-taking flag would be misread as the url
      // otherwise, but none of the others are relevant here.
      continue
    }
    if (!url && /^https?:\/\//i.test(tok)) url = tok
  }

  return url ? { url, headers } : null
}

/** One server definition → one result. Never throws — an entry this can't
 *  make sense of at all returns null and is dropped silently (e.g. a
 *  malformed entry with neither url nor command), same as before; anything
 *  recognizable but not applicable becomes an explicit `unsupported` entry
 *  instead, so the caller can report it by name rather than just a count. */
function parseServerEntry(serverName: string, def: any): McpImportEntry | null {
  if (!def || typeof def !== 'object') return null;

  if (typeof def.url === 'string' && def.url.trim()) {
    return { serverName, url: def.url.trim(), headers: parseHeaders(def.headers) };
  }

  if (typeof def.command === 'string' && def.command.trim()) {
    const remote = parseMcpRemoteArgs(def.command, def.args);
    if (remote) return { serverName, url: remote.url, headers: remote.headers };

    return {
      unsupported: true,
      serverName,
      reason: `"${serverName}" is a local (stdio) MCP server — command: "${def.command}". The MCP block currently only supports Streamable-HTTP servers with a "url" field (or an mcp-remote-wrapped one), not other locally spawned commands.`,
    };
  }

  return null;
}

export function parseMcpConfigJson(text: string): McpImportResult | null {
  const trimmed = text.trim();
  // Cheap fingerprint check before paying for JSON.parse on every paste.
  if (!trimmed.startsWith('{') || (!trimmed.includes('mcpServers') && !trimmed.includes('"servers"'))) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  // mcpServers (Claude Desktop/Cursor/Windsurf/Claude Code) or servers
  // (VS Code's .vscode/mcp.json) — same per-entry shape either way.
  const servers = parsed?.mcpServers ?? parsed?.servers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return null;

  const entries = Object.entries(servers)
    .map(([name, def]) => parseServerEntry(name, def))
    .filter((e): e is McpImportEntry => e !== null);

  return entries.length > 0 ? { entries } : null;
}
