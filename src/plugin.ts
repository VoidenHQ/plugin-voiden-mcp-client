/**
 * Voiden MCP Client Plugin
 *
 * Connects to an external MCP server over HTTP and runs a single operation
 * against it (list_tools, call_tool, list_resources, read_resource,
 * list_prompts, get_prompt) — Phase 1, HTTP transport only.
 */

import type { CorePluginContext } from '@voiden/sdk/ui';
type PluginContext = CorePluginContext;
import { resolveMcpBlock } from './lib/mcpBlocks';
import { parseMcpConfigJson } from './lib/mcpConfigImport';
import { applyMcpImport } from './lib/applyMcpImport';
import manifest from '../manifest.json';

export default function createMcpClientPlugin(context: PluginContext) {
  return {
    onload: async () => {
      const { NodeViewWrapper, CodeEditor, RequestBlockHeader } = context.ui.components;
      const { useSendRestRequest } = context.ui.hooks;
      const showToast = (context.ui as any).showToast?.bind(context.ui) as
        | ((message: string, type?: 'info' | 'success' | 'warning' | 'error') => void)
        | undefined;

      const {
        createMcpConnectionNode,
        createMcpUrlNode,
        createMcpOperationNode,
        createMcpResponseNode,
      } = await import('./nodes');

      const McpConnectionNode = createMcpConnectionNode(NodeViewWrapper, RequestBlockHeader);
      const McpUrlNode = createMcpUrlNode(NodeViewWrapper, useSendRestRequest);
      const McpOperationNode = createMcpOperationNode(NodeViewWrapper, CodeEditor);
      const McpResponseNode = createMcpResponseNode(NodeViewWrapper);

      context.registerVoidenExtension(McpConnectionNode);
      context.registerVoidenExtension(McpUrlNode);
      context.registerVoidenExtension(McpOperationNode);
      context.registerVoidenExtension(McpResponseNode);

      context.registerLinkableNodeTypes(['mcp-connection', 'mcpurl', 'mcpoperation', 'mcp-response']);

      const DOCS_URL = "https://docs.voiden.md/docs/core-features-section/voiden-blocks/mcp";
      (context as any).registerBlockOutlineMeta({
        'mcp-connection': { label: "MCP Connection", icon: "Plug", docsUrl: DOCS_URL },
        mcpurl: { label: "Server URL", icon: "Globe", docsUrl: DOCS_URL },
        mcpoperation: { label: "Operation", icon: "Wrench", docsUrl: DOCS_URL },
      });

      (context as any).registerBlockHelp?.({
        'mcp-connection': (await import('./help')).McpConnectionHelp,
        mcpoperation: (await import('./help')).McpOperationHelp,
      });

      context.onBuildRequest(async (request, editor) => {
        try {
          const editorJson = editor.getJSON();
          const cfg = resolveMcpBlock(editorJson.content);
          if (!cfg) return request; // Not an MCP doc, pass through

          // Same shared request-building utilities voiden-rest-api uses
          // (context.helpers.requestUtils, not private to REST) — reusing
          // them instead of hand-rolling our own header/auth-table readers
          // gets us the exact same headers-table/cookies-table merge,
          // query-table reading, and auth-node parsing (including inherited
          // auth from a .voiden-inherited.void ancestor file, which the old
          // hand-rolled reader here never handled) for free, and stays
          // correct automatically if that shared logic ever changes.
          const { getTable, parseAuthNode, buildHeadersWithCookies, findNode, findNodes, createNewRequestObject } =
            (context as any).helpers.requestUtils;

          const preRequestBlock = findNode(editorJson, 'pre_request_block');
          const postRequestBlocks = findNodes(editorJson, 'post_request_block');

          return {
            ...createNewRequestObject({ method: 'MCP', url: cfg.url }),
            protocolType: 'mcp',
            headers: buildHeadersWithCookies(editorJson, undefined),
            // Field name matches Request['params'] (getRequestFromJson.ts), not
            // RestApiRequestState['queryParams'] — sendRequestHybrid.ts's
            // convertToRestApiRequestState reads `data.params` to build the
            // executor-facing queryParams, so `params` is the name this layer
            // needs, same as voiden-rest-api's own onBuildRequest uses.
            params: getTable('query-table', editorJson, undefined),
            path_params: getTable('path-table', editorJson, undefined),
            auth: parseAuthNode(editorJson),
            prescript: preRequestBlock?.attrs?.body,
            postscript: postRequestBlocks?.map((n: any) => n?.attrs?.body).join('\n'),
            mcp: {
              operation: cfg.operation,
              toolName: cfg.toolName,
              toolArgs: cfg.toolArgs,
              resourceUri: cfg.resourceUri,
              promptName: cfg.promptName,
              promptArgs: cfg.promptArgs,
            },
          };
        } catch (error) {
          console.error('MCP onBuildRequest error:', error);
          throw error;
        }
      });

      context.addVoidenSlashGroup({
        name: 'mcp',
        title: 'MCP',
        commands: [
          {
            name: 'mcp-connection',
            label: 'MCP Connection',
            aliases: ['mcp'],
            compareKeys: ['mcp-connection'],
            singleton: true,
            slash: '/mcp',
            description: 'Connect to an MCP server and run an operation',
            action: (editor: any) => {
              if (!editor) return;
              editor
                .chain()
                .focus()
                .insertContent([
                  {
                    type: 'mcp-connection',
                    content: [
                      { type: 'mcpurl', content: [] },
                      { type: 'mcpoperation', attrs: { capabilityType: 'tool', args: '{\n  \n}' } },
                    ],
                  },
                  {
                    type: 'paragraph',
                  },
                ])
                .run();
            },
          },
        ],
      });

      // JSON import — paste a `{"mcpServers": {...}}` config (the shape used
      // by Claude Desktop / Cursor / VS Code / Windsurf) anywhere in a .void
      // file and fill in the block's URL (+ headers) from it, the same way
      // voiden-rest-api's cURL pattern handler builds a request from pasted
      // cURL. A "command"-based (stdio/local process) entry can't be applied
      // — Phase 1 is HTTP transport only — so that case surfaces a toast
      // instead of silently doing nothing or mangling the URL field.
      context.paste.registerPatternHandler({
        canHandle: (text: string) => parseMcpConfigJson(text) !== null,
        handle: (text: string) => {
          const parsed = parseMcpConfigJson(text);
          if (!parsed) return false;

          if ('unsupported' in parsed) {
            showToast?.(parsed.reason, 'warning');
            return true;
          }

          const editor = context.project.getActiveEditor('voiden');
          if (!editor) return false;

          applyMcpImport(editor, parsed, showToast);
          return true;
        },
      });

      // There is no generic/protocol-agnostic response viewer — every protocol
      // must build its own rendered response doc and call context.openVoidenTab,
      // which is the only thing that clears the response panel's loading state
      // (confirmed: REST's and GraphQL's onProcessResponse both do exactly this).
      // Unlike REST/GraphQL, this does NOT reuse the generic response-body/
      // response-headers node types — an MCP result (tool list, tool-call
      // content blocks, resource contents, prompt messages) doesn't fit a
      // generic HTTP body/headers shape, so mcp-response (McpResponseNode.tsx)
      // renders each operation's actual result shape directly.
      context.onProcessResponse(async (response) => {
        if (response.protocol !== 'mcp') return;

        try {
          const statusCode = response.statusCode ?? response.status ?? 0;
          const bodyRaw =
            typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? {});

          const responseDoc: any = {
            type: 'doc',
            attrs: {
              statusCode,
              statusMessage: response.statusMessage ?? response.statusText ?? '',
              elapsedTime: response.elapsedTime ?? 0,
              url: response.url,
              requestMeta: response.requestMeta,
              protocol: 'mcp',
            },
            content: [
              {
                type: 'mcp-response',
                attrs: {
                  bodyRaw,
                  statusCode,
                  elapsedTime: response.elapsedTime ?? 0,
                  requestMetaRaw: JSON.stringify(response.requestMeta ?? {}),
                },
              },
            ],
          };

          if (response.__sectionIndex !== undefined) {
            responseDoc.attrs.sectionIndex = response.__sectionIndex;
          }
          if (response.__sectionColorIndex !== undefined) {
            responseDoc.attrs.sectionColorIndex = response.__sectionColorIndex;
          }
          if (response.__sectionLabel) {
            responseDoc.attrs.sectionLabel = response.__sectionLabel;
          }

          await context.openVoidenTab(
            `Response ${statusCode}`,
            responseDoc,
            { readOnly: true }
          );
        } catch (error) {
          console.error('[voiden-mcp-client] onProcessResponse failed:', error);
          // Rethrow so requestOrchestrator's handler-loop safety net notices and
          // clears the stuck-loading state instead of an infinite spinner.
          throw error;
        }
      });
    },

    metadata: manifest,
  };
}
