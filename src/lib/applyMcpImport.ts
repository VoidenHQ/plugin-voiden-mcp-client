/**
 * Applies a parsed McpImportResult (see mcpConfigImport.ts) to the active
 * editor. The first supported (HTTP-transport) entry updates the existing
 * mcp-connection block's URL/headers in place if one's already in the doc
 * (creating it if not) — unchanged from single-entry behavior. Every
 * additional supported entry gets its own new connection+headers pair
 * appended after it, so a config with several servers produces one block
 * each, not just the first with the rest silently dropped.
 */

import type { McpImportEntry, McpImportResult } from './mcpConfigImport';
import { isUnsupported } from './mcpConfigImport';

type ToastFn = (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;

function findTopLevelNode(doc: any, typeName: string): { node: any; pos: number } | null {
  let found: { node: any; pos: number } | null = null;
  doc.forEach((node: any, offset: number) => {
    if (!found && node.type.name === typeName) found = { node, pos: offset };
  });
  return found;
}

function buildHeadersTableNode(headers: [string, string][]) {
  return {
    type: 'headers-table',
    content: [
      {
        type: 'table',
        content: headers.map(([key, value]) => ({
          type: 'tableRow',
          attrs: { disabled: false },
          content: [key, value].map((text) => ({
            type: 'tableCell',
            attrs: { colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
          })),
        })),
      },
    ],
  };
}

function buildConnectionNode(url: string) {
  return {
    type: 'mcp-connection',
    content: [
      { type: 'mcpurl', content: url ? [{ type: 'text', text: url }] : [] },
      { type: 'mcpoperation', attrs: { capabilityType: 'tool', args: '{\n  \n}' } },
    ],
  };
}

/** First supported entry only — updates the doc's existing connection
 *  block in place if there is one (same URL-cell-replace / headers-table-
 *  replace-or-insert-after-connection behavior this always had), otherwise
 *  inserts a fresh connection+headers pair at the cursor. */
function applyFirstEntry(editor: any, config: { url: string; headers: [string, string][] }) {
  const urlContent = config.url ? [{ type: 'text', text: config.url }] : [];
  const connection = findTopLevelNode(editor.state.doc, 'mcp-connection');

  if (connection) {
    const urlNode = connection.node.firstChild;
    if (urlNode && urlNode.type.name === 'mcpurl') {
      const from = connection.pos + 1;
      const to = from + urlNode.nodeSize;
      editor.chain().deleteRange({ from, to }).insertContentAt(from, { type: 'mcpurl', content: urlContent }).run();
    }
  } else {
    editor.chain().focus().insertContent([buildConnectionNode(config.url), { type: 'paragraph' }]).run();
  }

  if (config.headers.length > 0) {
    const headersNode = findTopLevelNode(editor.state.doc, 'headers-table');
    const tableNode = buildHeadersTableNode(config.headers);
    if (headersNode) {
      const from = headersNode.pos;
      const to = from + headersNode.node.nodeSize;
      editor.chain().deleteRange({ from, to }).insertContentAt(from, tableNode).run();
    } else {
      const conn = findTopLevelNode(editor.state.doc, 'mcp-connection');
      const insertPos = conn ? conn.pos + conn.node.nodeSize : editor.state.doc.content.size;
      editor.chain().insertContentAt(insertPos, tableNode).run();
    }
  }
}

/** Every entry after the first — always appended as a new pair at the end
 *  of the doc, never overwriting anything, since "update in place" only
 *  makes sense for a single existing connection block. */
function appendEntry(editor: any, config: { url: string; headers: [string, string][] }) {
  const content: any[] = [buildConnectionNode(config.url)];
  if (config.headers.length > 0) content.push(buildHeadersTableNode(config.headers));
  content.push({ type: 'paragraph' });
  const insertPos = editor.state.doc.content.size;
  editor.chain().insertContentAt(insertPos, content).run();
}

export function applyMcpImport(editor: any, result: McpImportResult, showToast?: ToastFn) {
  const supported = result.entries.filter((e): e is Extract<McpImportEntry, { url: string }> => !isUnsupported(e));
  const unsupported = result.entries.filter(isUnsupported);

  supported.forEach((config, i) => {
    if (i === 0) applyFirstEntry(editor, config);
    else appendEntry(editor, config);
  });

  const parts: string[] = [];
  if (supported.length > 0) {
    const names = supported.map((c) => c.serverName).filter(Boolean);
    parts.push(
      supported.length === 1
        ? `Imported MCP server${names[0] ? ` "${names[0]}"` : ''} → ${supported[0].url}`
        : `Imported ${supported.length} MCP servers${names.length ? ` (${names.join(', ')})` : ''}`
    );
    const headerCount = supported.reduce((n, c) => n + c.headers.length, 0);
    if (headerCount) parts.push(`${headerCount} header${headerCount === 1 ? '' : 's'} total`);
  }
  if (unsupported.length > 0) {
    parts.push(unsupported.map((u) => u.reason).join(' '));
  }

  if (parts.length === 0) return;
  showToast?.(parts.join(' — '), supported.length > 0 ? 'success' : 'warning');
}
