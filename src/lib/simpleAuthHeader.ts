/**
 * Minimal auth → header computation for silent discovery calls only.
 *
 * The real "Run" path gets full auth support (every type, including OAuth2
 * token refresh) for free via sendRequestHybrid's generic auth-merge — see
 * apps/ui/src/core/request-engine/sendRequestHybrid.ts. Discovery bypasses
 * that pipeline entirely (see discovery.ts), so it needs its own — but only
 * for the static auth types that don't depend on a runtime token-fetch flow:
 * bearer, basic, and header-based API key. OAuth2/digest/NTLM/etc. simply
 * won't authenticate discovery calls — the dropdowns fall back to their
 * manual-entry state, but the block itself (and Run) is unaffected.
 */


function readAuthTableConfig(authNode: any): Record<string, string> {
  const config: Record<string, string> = {};
  authNode.content?.forEach((node: any) => {
    if (node.type !== 'table') return;
    node.content?.forEach((rowNode: any) => {
      if (rowNode.type !== 'tableRow') return;
      let k = '', v = '';
      rowNode.content?.forEach((cellNode: any, idx: number) => {
        if (cellNode.type === 'tableCell') {
          const text = (cellNode.content?.[0]?.content?.[0]?.text || '').trim();
          if (idx === 0) k = text; else if (idx === 1) v = text;
        }
      });
      if (k) config[k] = v;
    });
  });
  return config;
}

/** Finds the `auth` block in the given doc content and returns a single
 *  {key, value} header for it, or null if there's no (supported) auth. */
export function computeSimpleAuthHeader(rootContent: any[] | undefined): { key: string; value: string } | null {
  const authNode = rootContent?.find((n: any) => n.type === 'auth');
  if (!authNode?.attrs) return null;
  const authType = authNode.attrs.authType;
  if (!authType || authType === 'inherit' || authType === 'none') return null;

  const config = readAuthTableConfig(authNode);

  if (authType === 'bearer') {
    if (!config.token) return null;
    return { key: 'Authorization', value: `Bearer ${config.token}` };
  }

  if (authType === 'basic') {
    if (!config.username && !config.password) return null;
    // UTF-8 → base64 without Buffer: this runs in the renderer, where a
    // plugin's own release build has no global Buffer to fall back on.
    const bytes = new TextEncoder().encode(`${config.username || ''}:${config.password || ''}`);
    const encoded = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
    return { key: 'Authorization', value: `Basic ${encoded}` };
  }

  if (authType === 'apiKey') {
    if (!config.key || !config.value) return null;
    const addTo = config.add_to || 'header';
    if (addTo !== 'header') return null; // query-param API keys aren't supported for discovery
    return { key: config.key, value: config.value };
  }

  return null;
}
