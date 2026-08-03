/**
 * Silent MCP capability discovery — list_tools/list_resources/list_prompts,
 * called directly against window.electron.request.sendSecure rather than
 * going through onBuildRequest/sendRequestHybrid/requestOrchestrator. That
 * full pipeline is for an explicit user-initiated "Run" — it opens a response
 * tab and touches global loading state, neither of which belongs to a
 * background editor convenience that fires on mount / while typing a URL.
 *
 * Mirrors the exact pattern voiden-graphql's GqlBodyNode.tsx already uses for
 * schema introspection (same direct sendSecure call, same Buffer→JSON parse),
 * which is proven to have zero side effects on shared app state.
 */

import { Buffer } from "buffer";

export interface DiscoveredTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: any;
}

export interface DiscoveredResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface DiscoveredPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface DiscoveryResult {
  tools: DiscoveredTool[];
  resources: DiscoveredResource[];
  prompts: DiscoveredPrompt[];
  /** Set when ALL three categories failed (e.g. server unreachable) — a
   *  single category not being supported by the server is not an error. */
  error?: string;
}

type Header = { key: string; value: string; enabled: boolean };

async function listOne(
  url: string,
  headers: Header[],
  operation: 'list_tools' | 'list_resources' | 'list_prompts',
): Promise<{ ok: boolean; data: any; error?: string }> {
  try {
    const requestState = {
      method: 'MCP',
      url,
      headers,
      queryParams: [],
      pathParams: [],
      protocolType: 'mcp',
      mcp: { operation },
    };
    const response = await (window as any).electron?.request?.sendSecure(requestState);
    if (!response || !response.status || response.status < 200 || response.status >= 300) {
      return { ok: false, data: null, error: `HTTP ${response?.status ?? 'N/A'}: ${response?.statusText || 'Unknown error'}` };
    }
    if (!response.body) return { ok: false, data: null, error: 'No response body received.' };
    const buffer = Buffer.from(response.body);
    const parsed = JSON.parse(buffer.toString());
    if (parsed?.error) return { ok: false, data: null, error: parsed.error };
    return { ok: true, data: parsed };
  } catch (err: any) {
    return { ok: false, data: null, error: err?.message || String(err) };
  }
}

export async function discoverMcpCapabilities(url: string, headers: Header[]): Promise<DiscoveryResult> {
  const [toolsRes, resourcesRes, promptsRes] = await Promise.all([
    listOne(url, headers, 'list_tools'),
    listOne(url, headers, 'list_resources'),
    listOne(url, headers, 'list_prompts'),
  ]);

  if (!toolsRes.ok && !resourcesRes.ok && !promptsRes.ok) {
    return { tools: [], resources: [], prompts: [], error: toolsRes.error || 'Could not connect to MCP server.' };
  }

  return {
    tools: toolsRes.ok ? (toolsRes.data.tools || []) : [],
    resources: resourcesRes.ok ? (resourcesRes.data.resources || []) : [],
    prompts: promptsRes.ok ? (promptsRes.data.prompts || []) : [],
  };
}
