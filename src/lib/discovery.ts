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
  /** Set when that failure was specifically a 401 — lets the UI show "this
   *  server needs authorization" instead of a generic connection warning. */
  authRequired?: boolean;
  /** Best-effort direct link to the server's real login page, when
   *  authRequired is true — see executors/src/mcp.ts's discoverAuthorizeUrl
   *  for how it's resolved. May be absent even when authRequired is true. */
  authorizeUrl?: string;
}

type Header = { key: string; value: string; enabled: boolean };

/** The response body as text. Crosses IPC as a Uint8Array (a Node Buffer on
 *  the main side). Decoded with TextDecoder, not Buffer: a plugin's own
 *  release build maps `buffer` to globalThis.Buffer, which the renderer
 *  doesn't have — Buffer.from() threw, the body was dropped, and a 401 lost
 *  its authRequired flag ("HTTP 0: MCP request failed" instead of Authorize). */
function bodyText(body: unknown): string | null {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
  const data = (body as any)?.data;
  if ((body as any)?.type === 'Buffer' && Array.isArray(data)) return new TextDecoder().decode(Uint8Array.from(data));
  return null;
}

async function listOne(
  url: string,
  headers: Header[],
  operation: 'list_tools' | 'list_resources' | 'list_prompts',
): Promise<{ ok: boolean; data: any; error?: string; authRequired?: boolean; authorizeUrl?: string }> {
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
    // secureRequest.ts's mcp branch always returns a JSON body, success or
    // failure — its `status` is a synthetic 200/0, not a real HTTP code, so
    // the actual detail (including authRequired/authorizeUrl) lives in the
    // body regardless of what `status` says. Parse it before deciding
    // success/failure, not after bailing on status alone — bailing first
    // used to silently throw away authRequired/authorizeUrl on every
    // failure, since status:0 never passes the 200-299 check below.
    let parsed: any = null;
    const text = bodyText(response?.body);
    if (text) {
      try { parsed = JSON.parse(text); } catch { /* not JSON — fall through to the generic error below */ }
    }
    if (!response || !response.status || response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        data: null,
        error: parsed?.error || `HTTP ${response?.status ?? 'N/A'}: ${response?.statusText || 'Unknown error'}`,
        authRequired: parsed?.authRequired,
        authorizeUrl: parsed?.authorizeUrl,
      };
    }
    if (!parsed) return { ok: false, data: null, error: 'No response body received.' };
    if (parsed?.error) return { ok: false, data: null, error: parsed.error, authRequired: parsed.authRequired, authorizeUrl: parsed.authorizeUrl };
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
    return {
      tools: [], resources: [], prompts: [],
      error: toolsRes.error || 'Could not connect to MCP server.',
      authRequired: toolsRes.authRequired || resourcesRes.authRequired || promptsRes.authRequired,
      authorizeUrl: toolsRes.authorizeUrl || resourcesRes.authorizeUrl || promptsRes.authorizeUrl,
    };
  }

  return {
    tools: toolsRes.ok ? (toolsRes.data.tools || []) : [],
    resources: resourcesRes.ok ? (resourcesRes.data.resources || []) : [],
    prompts: promptsRes.ok ? (promptsRes.data.prompts || []) : [],
  };
}
