/**
 * Applies a parsed McpImportConfig (see mcpConfigImport.ts) to the active
 * editor: fills in the mcp-connection block's URL (creating the block if one
 * isn't already in the doc) and, if the config carried headers, replaces the
 * headers-table sitting alongside it.
 */

import type { McpImportConfig } from './mcpConfigImport';

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

export function applyMcpImport(editor: any, config: McpImportConfig, showToast?: ToastFn) {
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
    editor
      .chain()
      .focus()
      .insertContent([
        {
          type: 'mcp-connection',
          content: [
            { type: 'mcpurl', content: urlContent },
            { type: 'mcpoperation', attrs: { capabilityType: 'tool', args: '{\n  \n}' } },
          ],
        },
        { type: 'paragraph' },
      ])
      .run();
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

  const parts = [`Imported MCP server${config.serverName ? ` "${config.serverName}"` : ''} → ${config.url}`];
  if (config.headers.length) {
    parts.push(`${config.headers.length} header${config.headers.length === 1 ? '' : 's'}`);
  }
  if (config.extraCount) {
    parts.push(`${config.extraCount} other server${config.extraCount === 1 ? '' : 's'} in the pasted config ignored (only one connection per block)`);
  }
  showToast?.(parts.join(' — '), 'success');
}
