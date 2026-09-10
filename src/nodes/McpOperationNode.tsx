/**
 * MCP Operation Node
 *
 * Postman-style capability picker: as soon as a URL is present on the
 * sibling mcpurl node, silently discovers what the server offers
 * (list_tools/list_resources/list_prompts, via lib/discovery.ts — a direct
 * sendSecure call, not the full Run pipeline) and lets the user pick a
 * specific tool/resource/prompt from a dropdown instead of typing names.
 * Selecting a tool or prompt pre-fills the args editor from its schema.
 *
 * The wire-level operation (call_tool/read_resource/get_prompt) is always
 * derived from which TYPE is selected — list_tools/list_resources/list_prompts
 * are an invisible discovery-only implementation detail, never something the
 * user picks or "Runs" directly (see lib/mcpBlocks.ts's resolveMcpBlock).
 */

import React from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Sparkles, RefreshCw, TriangleAlert, KeyRound } from "lucide-react";
import { discoverMcpCapabilities, type DiscoveryResult } from "../lib/discovery";
import { computeSimpleAuthHeader } from "../lib/simpleAuthHeader";
import { toolSchemaToTemplate, promptArgsToTemplate } from "../lib/schemaTemplate";

export type McpCapabilityType = "tool" | "resource" | "prompt";

const prettifyJSON = (json: string) => {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
};

/** Reads the sibling mcpurl node's current text — mcpurl/mcpoperation are
 *  fixed direct children of the same mcp-connection parent (content model
 *  "(mcpurl mcpoperation)?"), so this only needs to look at the immediate
 *  parent, unlike a top-level-sibling search across request sections. */
function getSiblingUrl(editor: any, getPos: () => number | undefined): string {
  const pos = typeof getPos === "function" ? getPos() : null;
  if (pos == null) return "";
  try {
    const $pos = editor.state.doc.resolve(pos);
    const parent = $pos.parent;
    let url = "";
    parent.forEach((child: any) => {
      if (child.type.name === "mcpurl") url = child.textContent || "";
    });
    return url.trim();
  } catch {
    return "";
  }
}

/** All top-level nodes in the same request section as this block (bounded by
 *  request-separator nodes) — used to find headers-table/auth blocks the
 *  same way plugin.ts's onBuildRequest does, so discovery calls carry the
 *  same headers/auth a real Run would. */
function getSectionSiblings(editor: any, getPos: () => number | undefined): any[] {
  const pos = typeof getPos === "function" ? getPos() : null;
  if (pos == null) return [];
  const doc = editor.state.doc;
  const topLevel: Array<{ type: string; node: any; pos: number }> = [];
  doc.forEach((node: any, p: number) => topLevel.push({ type: node.type.name, node, pos: p }));

  let ourIdx = -1;
  for (let i = 0; i < topLevel.length; i++) {
    const { pos: p, node } = topLevel[i];
    if (pos >= p && pos < p + node.nodeSize) {
      ourIdx = i;
      break;
    }
  }
  if (ourIdx === -1) return [];

  let start = ourIdx;
  while (start > 0 && topLevel[start - 1].type !== "request-separator") start--;
  let end = ourIdx;
  while (end < topLevel.length - 1 && topLevel[end + 1].type !== "request-separator") end++;

  return topLevel.slice(start, end + 1).map((t) => t.node.toJSON());
}

function buildDiscoveryHeaders(sectionSiblings: any[]): Array<{ key: string; value: string; enabled: boolean }> {
  const headers: Array<{ key: string; value: string; enabled: boolean }> = [];
  const headersTable = sectionSiblings.find((n) => n.type === "headers-table");
  if (headersTable) {
    headersTable.content?.forEach((node: any) => {
      if (node.type !== "table") return;
      node.content?.forEach((rowNode: any) => {
        if (rowNode.type !== "tableRow" || rowNode.attrs?.disabled) return;
        let key = "", value = "";
        rowNode.content?.forEach((cellNode: any, idx: number) => {
          if (cellNode.type === "tableCell") {
            const text = (cellNode.content?.[0]?.content?.[0]?.text || "").trim();
            if (idx === 0) key = text; else if (idx === 1) value = text;
          }
        });
        if (key) headers.push({ key, value, enabled: true });
      });
    });
  }
  const authHeader = computeSimpleAuthHeader(sectionSiblings);
  if (authHeader) headers.push({ ...authHeader, enabled: true });
  return headers;
}

export const createMcpOperationNode = (NodeViewWrapper: any, CodeEditor: any) => {
  const McpOperationComponent = (props: any) => {
    const isImported = !!props.node.attrs.importedFrom;
    const isEditable = props.editor.isEditable && !isImported;
    const capabilityType = (props.node.attrs.capabilityType || "tool") as McpCapabilityType;
    const toolName = props.node.attrs.toolName || "";
    const resourceUri = props.node.attrs.resourceUri || "";
    const promptName = props.node.attrs.promptName || "";

    const [discovery, setDiscovery] = React.useState<DiscoveryResult | null>(null);
    const [status, setStatus] = React.useState<"idle" | "loading" | "success" | "error">("idle");
    const [error, setError] = React.useState<string | null>(null);
    // Mirrors `error` rather than living on `discovery` — discovery gets set
    // to null on any failure (existing behavior, kept as-is below), so a
    // field on it wouldn't survive to render the auth-specific banner.
    const [authRequired, setAuthRequired] = React.useState(false);
    const [authorizeUrl, setAuthorizeUrl] = React.useState<string | undefined>(undefined);
    const [authorizing, setAuthorizing] = React.useState(false);
    const [manualTool, setManualTool] = React.useState(false);
    const [manualResource, setManualResource] = React.useState(false);
    const [manualPrompt, setManualPrompt] = React.useState(false);

    const lastKeyRef = React.useRef<string>("");
    const debounceRef = React.useRef<any>(null);
    const lastAutoFilledForRef = React.useRef<string>("");

    const runDiscovery = React.useCallback((force = false) => {
      if (typeof props.getPos !== "function") return;
      const url = getSiblingUrl(props.editor, props.getPos);
      if (!url) {
        lastKeyRef.current = "";
        setDiscovery(null);
        setStatus("idle");
        setError(null);
        setAuthRequired(false);
        setAuthorizeUrl(undefined);
        return;
      }
      const headers = buildDiscoveryHeaders(getSectionSiblings(props.editor, props.getPos));
      const key = url + "|" + JSON.stringify(headers);
      if (!force && key === lastKeyRef.current) return;
      lastKeyRef.current = key;
      setStatus("loading");
      discoverMcpCapabilities(url, headers).then((result) => {
        if (result.error) {
          setStatus("error");
          setError(result.error);
          setAuthRequired(!!result.authRequired);
          setAuthorizeUrl(result.authorizeUrl);
          setDiscovery(null);
        } else {
          setStatus("success");
          setDiscovery(result);
          setError(null);
          setAuthRequired(false);
          setAuthorizeUrl(undefined);
        }
      });
    }, [props.editor]);

    // Drives the full OAuth handshake via the main process (see
    // ipc/request.ts's "mcp:authorize-server" — discovery, DCR, opening the
    // real system browser, and a loopback listener all live there/in
    // @voiden/executors, not here). On success, re-runs discovery so the
    // newly-saved token gets picked up immediately instead of waiting for
    // the next edit to this block to trigger it.
    const handleAuthorize = React.useCallback(async () => {
      if (typeof props.getPos !== "function") return;
      const url = getSiblingUrl(props.editor, props.getPos);
      if (!url || authorizing) return;
      setAuthorizing(true);
      try {
        const result = await (window as any).electron?.request?.authorizeMcpServer(url);
        if (result?.success) {
          runDiscovery(true);
        } else {
          setError(result?.error || "Authorization failed.");
          setStatus("error");
        }
      } catch (err: any) {
        setError(err?.message || String(err));
        setStatus("error");
      } finally {
        setAuthorizing(false);
      }
    }, [props.editor, authorizing, runDiscovery]);

    React.useEffect(() => {
      runDiscovery();
      const handler = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runDiscovery(), 600);
      };
      props.editor.on("update", handler);
      return () => {
        props.editor.off("update", handler);
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSelectTool = (name: string) => {
      const tool = discovery?.tools?.find((t) => t.name === name);
      const updates: any = { toolName: name };
      if (tool && lastAutoFilledForRef.current !== `tool:${name}`) {
        updates.args = toolSchemaToTemplate(tool.inputSchema);
        lastAutoFilledForRef.current = `tool:${name}`;
      }
      props.updateAttributes(updates);
    };

    const handleSelectPrompt = (name: string) => {
      const prompt = discovery?.prompts?.find((p) => p.name === name);
      const updates: any = { promptName: name };
      if (prompt && lastAutoFilledForRef.current !== `prompt:${name}`) {
        updates.args = promptArgsToTemplate(prompt.arguments);
        lastAutoFilledForRef.current = `prompt:${name}`;
      }
      props.updateAttributes(updates);
    };

    const handlePrettify = () => {
      try {
        props.updateAttributes({ args: prettifyJSON(props.node.attrs.args || "{}") });
      } catch {}
    };

    const selectClass =
      "px-2 py-0.5 text-xs font-mono bg-bg border border-border rounded text-text focus:outline-none focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed";
    const inputClass =
      "flex-1 px-2 py-1 bg-editor border border-border rounded text-sm text-text font-mono focus:outline-none focus:border-accent disabled:opacity-50";
    const linkClass = "text-xs text-comment hover:text-text underline shrink-0";
    const rowClass = "bg-panel border-b border-border px-3 py-1.5 flex items-center gap-2 flex-wrap";

    const tools = discovery?.tools || [];
    const resources = discovery?.resources || [];
    const prompts = discovery?.prompts || [];

    const toolOptions = toolName && !tools.some((t) => t.name === toolName)
      ? [{ name: toolName, title: "(saved)" }, ...tools] : tools;
    const resourceOptions = resourceUri && !resources.some((r) => r.uri === resourceUri)
      ? [{ uri: resourceUri, name: "(saved)" }, ...resources] : resources;
    const promptOptions = promptName && !prompts.some((p) => p.name === promptName)
      ? [{ name: promptName, description: "(saved)" }, ...prompts] : prompts;

    const needsArgs = capabilityType === "tool" || capabilityType === "prompt";

    return (
      <NodeViewWrapper>
        <div className="my-2">
          <div className={rowClass}>
            <span className="text-xs text-comment font-medium uppercase tracking-wide shrink-0">Type</span>
            <select
              value={capabilityType}
              onChange={(e) => props.updateAttributes({ capabilityType: e.target.value })}
              disabled={!isEditable}
              className={selectClass}
            >
              <option value="tool">Tool</option>
              <option value="resource">Resource</option>
              <option value="prompt">Prompt</option>
            </select>
            {authRequired && (
              <button
                onClick={handleAuthorize}
                disabled={!isEditable || authorizing}
                title="Sign in with your real browser — Voiden completes the handshake automatically once you do, no token to copy"
                className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono text-status-warning hover:text-text transition-colors opacity-90 hover:opacity-100 disabled:opacity-40"
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                <KeyRound size={11} className={authorizing ? "animate-pulse" : ""} />
                <span>{authorizing ? "WAITING FOR BROWSER…" : "AUTHORIZE"}</span>
              </button>
            )}
            <button
              onClick={() => runDiscovery(true)}
              disabled={!isEditable}
              title="Re-discover capabilities from the server"
              className={`flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono text-comment hover:text-text transition-colors opacity-70 hover:opacity-100 disabled:opacity-30${authRequired ? "" : " ml-auto"}`}
              style={{ cursor: "pointer", userSelect: "none" }}
            >
              <RefreshCw size={11} className={status === "loading" ? "animate-spin" : ""} />
              <span>{status === "loading" ? "DISCOVERING" : "REFRESH"}</span>
            </button>
          </div>

          {status === "error" && authRequired && (
            // Distinct from the generic warning below — this is a specific,
            // actionable signal (401), not "might be a transient blip", so
            // it gets its own clearer copy and doesn't get lumped in with
            // real connectivity problems.
            <div className="bg-panel border-b border-border px-3 py-1.5 flex items-center gap-1.5 text-xs text-status-warning">
              <KeyRound size={12} className="shrink-0" />
              <span>This server requires authorization — click Authorize above to sign in.</span>
            </div>
          )}

          {status === "error" && !authRequired && (
            // Discovery failing isn't the same as this block being broken —
            // the server might just be cold-starting, briefly unreachable,
            // or not up yet, and a tool/resource/prompt name can still be
            // typed manually below regardless (see manualTool/etc. above).
            // Warning-toned, not error-toned, so it doesn't read as "this
            // operation is misconfigured" when it's really "couldn't check
            // just now — try again, or type the name directly."
            <div className="bg-panel border-b border-border px-3 py-1.5 flex items-center gap-1.5 text-xs text-status-warning">
              <TriangleAlert size={12} className="shrink-0" />
              <span>Couldn't discover capabilities (server may be starting up or briefly unreachable): {error}</span>
            </div>
          )}

          {capabilityType === "tool" && (
            <div className={rowClass}>
              <span className="text-xs text-comment font-medium uppercase tracking-wide shrink-0">Tool</span>
              {manualTool || (tools.length === 0 && status !== "loading") ? (
                <>
                  <input
                    type="text"
                    value={toolName}
                    onChange={(e) => props.updateAttributes({ toolName: e.target.value })}
                    disabled={!isEditable}
                    placeholder="e.g. create_customer"
                    className={inputClass}
                  />
                  {tools.length > 0 && (
                    <button onClick={() => setManualTool(false)} className={linkClass}>Pick from list</button>
                  )}
                </>
              ) : (
                <>
                  <select value={toolName} onChange={(e) => handleSelectTool(e.target.value)} disabled={!isEditable} className={selectClass + " flex-1"}>
                    <option value="">Select a tool…</option>
                    {toolOptions.map((t) => (
                      <option key={t.name} value={t.name}>{t.name}{t.title && t.title !== "(saved)" ? ` — ${t.title}` : t.title === "(saved)" ? " (saved)" : ""}</option>
                    ))}
                  </select>
                  <button onClick={() => setManualTool(true)} className={linkClass}>Enter manually</button>
                </>
              )}
            </div>
          )}

          {capabilityType === "resource" && (
            <div className={rowClass}>
              <span className="text-xs text-comment font-medium uppercase tracking-wide shrink-0">Resource</span>
              {manualResource || (resources.length === 0 && status !== "loading") ? (
                <>
                  <input
                    type="text"
                    value={resourceUri}
                    onChange={(e) => props.updateAttributes({ resourceUri: e.target.value })}
                    disabled={!isEditable}
                    placeholder="e.g. file:///project/notes.txt"
                    className={inputClass}
                  />
                  {resources.length > 0 && (
                    <button onClick={() => setManualResource(false)} className={linkClass}>Pick from list</button>
                  )}
                </>
              ) : (
                <>
                  <select
                    value={resourceUri}
                    onChange={(e) => props.updateAttributes({ resourceUri: e.target.value })}
                    disabled={!isEditable}
                    className={selectClass + " flex-1"}
                  >
                    <option value="">Select a resource…</option>
                    {resourceOptions.map((r) => (
                      <option key={r.uri} value={r.uri}>{r.name && r.name !== "(saved)" ? `${r.name} — ${r.uri}` : r.name === "(saved)" ? `${r.uri} (saved)` : r.uri}</option>
                    ))}
                  </select>
                  <button onClick={() => setManualResource(true)} className={linkClass}>Enter manually</button>
                </>
              )}
            </div>
          )}

          {capabilityType === "prompt" && (
            <div className={rowClass}>
              <span className="text-xs text-comment font-medium uppercase tracking-wide shrink-0">Prompt</span>
              {manualPrompt || (prompts.length === 0 && status !== "loading") ? (
                <>
                  <input
                    type="text"
                    value={promptName}
                    onChange={(e) => props.updateAttributes({ promptName: e.target.value })}
                    disabled={!isEditable}
                    placeholder="e.g. summarize"
                    className={inputClass}
                  />
                  {prompts.length > 0 && (
                    <button onClick={() => setManualPrompt(false)} className={linkClass}>Pick from list</button>
                  )}
                </>
              ) : (
                <>
                  <select value={promptName} onChange={(e) => handleSelectPrompt(e.target.value)} disabled={!isEditable} className={selectClass + " flex-1"}>
                    <option value="">Select a prompt…</option>
                    {promptOptions.map((p) => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                  <button onClick={() => setManualPrompt(true)} className={linkClass}>Enter manually</button>
                </>
              )}
            </div>
          )}

          {needsArgs ? (
            <>
              <div className="bg-panel border-b border-border px-3 py-1 flex items-center justify-end">
                <button
                  className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono text-comment hover:text-text transition-colors opacity-60 hover:opacity-100"
                  onClick={handlePrettify}
                  style={{ cursor: "pointer", userSelect: "none" }}
                >
                  <Sparkles size={11} />
                  <span>PRETTIFY</span>
                </button>
              </div>
              <div style={{ height: "auto" }}>
                <CodeEditor
                  tiptapProps={{
                    ...props,
                    node: { ...props.node, attrs: { ...props.node.attrs, body: props.node.attrs.args } },
                    updateAttributes: (attrs: any) => {
                      if (attrs.body !== undefined) props.updateAttributes({ args: attrs.body });
                    },
                  }}
                  lang="jsonc"
                  showReplace={false}
                  readOnly={!isEditable}
                />
              </div>
            </>
          ) : (
            <div className="bg-editor px-3 py-2 text-xs text-comment italic">
              No parameters needed — the selected resource URI is the entire input.
            </div>
          )}
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "mcpoperation",
    group: "block",
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        capabilityType: { default: "tool" },
        toolName: { default: "" },
        resourceUri: { default: "" },
        promptName: { default: "" },
        args: { default: "{\n  \n}" },
        importedFrom: { default: undefined },
      };
    },

    parseHTML() {
      return [{ tag: "mcpoperation" }];
    },

    renderHTML({ HTMLAttributes }: any) {
      return ["div", mergeAttributes(HTMLAttributes, { class: "mcp-operation-block" })];
    },

    addNodeView() {
      return ReactNodeViewRenderer(McpOperationComponent);
    },

    addKeyboardShortcuts() {
      return {
        Backspace: ({ editor }: any) => {
          const { selection } = editor.state;
          const node = selection.$from.node();
          if (node?.type.name === "mcpoperation") return true;
          return false;
        },
        Delete: ({ editor }: any) => {
          const { selection } = editor.state;
          const node = selection.$from.node();
          if (node?.type.name === "mcpoperation") return true;
          return false;
        },
      };
    },
  });
};

export const McpOperationNode = createMcpOperationNode(
  ({ children }: any) => <div>{children}</div>,
  () => <div>CodeEditor not available</div>
);
