/**
 * Shared MCP block-resolution logic.
 *
 * Works against both the TipTap editorJson.content shape (plugin.ts, in the
 * running app) and the headless Block[] shape (runner.ts, CLI/voiden-mcp) —
 * both use { type, attrs?, content }, content being either a nested node
 * array or a plain string (see @voiden/sdk/runner's Block type).
 */

export type McpOperationType =
  | 'list_tools' | 'call_tool' | 'list_resources' | 'read_resource' | 'list_prompts' | 'get_prompt';

export type McpCapabilityType = 'tool' | 'resource' | 'prompt';

const CAPABILITY_TO_OPERATION: Record<McpCapabilityType, McpOperationType> = {
  tool: 'call_tool',
  resource: 'read_resource',
  prompt: 'get_prompt',
};

export interface McpBlockConfig {
  url: string;
  operation: McpOperationType;
  toolName?: string;
  toolArgs?: Record<string, any>;
  resourceUri?: string;
  promptName?: string;
  promptArgs?: Record<string, any>;
}

function extractUrlText(urlNode: any): string {
  const content = urlNode?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((n: any) => (typeof n?.text === 'string' ? n.text : ''))
      .join('')
      .trim();
  }
  return '';
}

export function resolveMcpBlock(rootContent: any[] | undefined): McpBlockConfig | null {
  const connectionNode = rootContent?.find((n: any) => n.type === 'mcp-connection');
  if (!connectionNode) return null;

  const children = Array.isArray(connectionNode.content) ? connectionNode.content : [];
  const urlNode = children.find((n: any) => n.type === 'mcpurl');
  const opNode = children.find((n: any) => n.type === 'mcpoperation');

  const url = extractUrlText(urlNode);
  const capabilityType = (opNode?.attrs?.capabilityType || 'tool') as McpCapabilityType;
  const operation = CAPABILITY_TO_OPERATION[capabilityType] || 'call_tool';

  let toolArgs: Record<string, any> | undefined;
  let promptArgs: Record<string, any> | undefined;
  const rawArgs = opNode?.attrs?.args;
  if (rawArgs && (operation === 'call_tool' || operation === 'get_prompt')) {
    try {
      const parsed = JSON.parse(rawArgs);
      if (operation === 'call_tool') toolArgs = parsed;
      if (operation === 'get_prompt') promptArgs = parsed;
    } catch {
      // Leave undefined — the server call then fails with a clear message
      // rather than silently sending malformed arguments.
    }
  }

  return {
    url,
    operation,
    toolName: opNode?.attrs?.toolName || undefined,
    toolArgs,
    resourceUri: opNode?.attrs?.resourceUri || undefined,
    promptName: opNode?.attrs?.promptName || undefined,
    promptArgs,
  };
}
