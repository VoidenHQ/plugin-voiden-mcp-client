/**
 * MCP Response Node
 *
 * Renders an MCP operation's result the way its shape actually calls for —
 * not the generic REST status/headers/body viewer. Tools/resources/prompts
 * lists render as cards; call_tool/get_prompt render their content/message
 * blocks; read_resource renders its contents. A Raw JSON toggle and a Copy
 * button are always available alongside the tailored view. The whole body
 * is collapsible (chevron in the header, matching voiden-rest-api's
 * response-body/response-headers nodes), and any JSON/text payload is
 * rendered through the shared CodeEditor component instead of a plain
 * `<pre>`, so it gets the same syntax highlighting, search, and selection
 * behavior as every other code view in the app.
 */

import React from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Square, FileText, BookOpen, AlertCircle, Copy, Check, ChevronDown } from "lucide-react";

function tryParse(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Response tabs are opened read-only, and the ProseMirror editor root applies
// user-select:none while non-editable — every text-bearing element below
// re-asserts selection explicitly so users can still select/copy content.
const SELECTABLE: React.CSSProperties = { userSelect: "text", WebkitUserSelect: "text" };

const Badge = ({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "success" | "error" }) => {
  const toneClass =
    tone === "success" ? "bg-status-success/15 text-status-success" :
    tone === "error" ? "bg-status-error/15 text-status-error" :
    "bg-accent/10 text-comment";
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${toneClass}`} style={SELECTABLE}>
      {children}
    </span>
  );
};

const Card = ({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "error" }) => (
  <div
    className={`border rounded p-3 space-y-1.5 ${tone === "error" ? "border-status-error/40 bg-status-error/5" : "border-border bg-editor"}`}
    style={SELECTABLE}
  >
    {children}
  </div>
);

const Pre = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <pre className={`text-xs font-mono whitespace-pre-wrap break-words ${className}`} style={SELECTABLE}>
    {children}
  </pre>
);

function ErrorBlock({ message }: { message: string }) {
  return (
    <Card tone="error">
      <div className="flex items-center gap-1.5 text-status-error text-xs font-semibold">
        <AlertCircle size={13} className="shrink-0" />
        <span>Request failed</span>
      </div>
      <Pre className="text-status-error">{message || "Unknown error."}</Pre>
    </Card>
  );
}

const OPERATION_LABELS: Record<string, string> = {
  list_tools: "List Tools",
  call_tool: "Call Tool",
  list_resources: "List Resources",
  read_resource: "Read Resource",
  list_prompts: "List Prompts",
  get_prompt: "Get Prompt",
};

export const createMcpResponseNode = (NodeViewWrapper: any, CodeEditor: any) => {
  // Renders a JSON value (or raw text) through the shared CodeEditor —
  // read-only, auto-height, same as voiden-rest-api's response-body/
  // response-headers nodes — instead of a plain `<pre>`.
  const CodeBlock = ({ value, lang = "json" }: { value: any; lang?: string }) => {
    const text = lang === "json" ? JSON.stringify(value, null, 2) : String(value ?? "");
    return (
      <div className="border border-border rounded overflow-hidden" style={SELECTABLE}>
        <CodeEditor readOnly lang={lang} value={text} />
      </div>
    );
  };

  // MCP tool/prompt/resource "text" content is untyped — plenty of servers
  // hand back JSON-encoded strings as their text content, not just prose —
  // so sniff it and light up the JSON highlighter (pretty-printed) instead
  // of always falling back to the no-highlight "text" lang.
  const TextBlock = ({ text }: { text: string }) => {
    const asJson = React.useMemo(() => tryParse(text ?? ""), [text]);
    return asJson !== null ? <CodeBlock value={asJson} lang="json" /> : <CodeBlock value={text} lang="text" />;
  };

  function ToolsList({ tools }: { tools: any[] }) {
    if (!tools?.length) return <div className="text-xs text-comment italic">No tools.</div>;
    return (
      <div className="space-y-2">
        {tools.map((tool: any) => (
          <Card key={tool.name}>
            <div className="flex items-center gap-2">
              <Square size={13} className="text-accent shrink-0" />
              <span className="font-mono text-sm text-text">{tool.name}</span>
              {tool.title && <span className="text-xs text-comment">— {tool.title}</span>}
            </div>
            {tool.description && <p className="text-xs text-comment" style={SELECTABLE}>{tool.description}</p>}
            {tool.inputSchema && (
              <details className="text-xs">
                <summary className="cursor-pointer text-comment hover:text-text select-none">Input schema</summary>
                <div className="mt-1.5">
                  <CodeBlock value={tool.inputSchema} />
                </div>
              </details>
            )}
          </Card>
        ))}
      </div>
    );
  }

  function ResourcesList({ resources }: { resources: any[] }) {
    if (!resources?.length) return <div className="text-xs text-comment italic">No resources.</div>;
    return (
      <div className="space-y-2">
        {resources.map((res: any) => (
          <Card key={res.uri}>
            <div className="flex items-center gap-2 flex-wrap">
              <FileText size={13} className="text-accent shrink-0" />
              <span className="font-mono text-sm text-text break-all">{res.uri}</span>
              {res.mimeType && <Badge>{res.mimeType}</Badge>}
            </div>
            {res.name && <div className="text-xs text-text" style={SELECTABLE}>{res.name}</div>}
            {res.description && <p className="text-xs text-comment" style={SELECTABLE}>{res.description}</p>}
          </Card>
        ))}
      </div>
    );
  }

  function PromptsList({ prompts }: { prompts: any[] }) {
    if (!prompts?.length) return <div className="text-xs text-comment italic">No prompts.</div>;
    return (
      <div className="space-y-2">
        {prompts.map((p: any) => (
          <Card key={p.name}>
            <div className="flex items-center gap-2">
              <BookOpen size={13} className="text-accent shrink-0" />
              <span className="font-mono text-sm text-text">{p.name}</span>
            </div>
            {p.description && <p className="text-xs text-comment" style={SELECTABLE}>{p.description}</p>}
            {Array.isArray(p.arguments) && p.arguments.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {p.arguments.map((a: any) => (
                  <Badge key={a.name} tone={a.required ? "error" : "default"}>
                    {a.name}{a.required ? "*" : ""}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    );
  }

  function ContentBlocks({ content, isError }: { content: any[]; isError?: boolean }) {
    return (
      <div className="space-y-2">
        {isError && (
          <div className="flex items-center gap-1.5 text-status-error text-xs">
            <AlertCircle size={13} /> Tool reported an error
          </div>
        )}
        {(content || []).map((block: any, i: number) => {
          if (block.type === "text") {
            return <TextBlock key={i} text={block.text} />;
          }
          if (block.type === "image" && block.data) {
            return (
              <img
                key={i}
                src={`data:${block.mimeType || "image/png"};base64,${block.data}`}
                alt="MCP image content"
                className="max-w-full rounded border border-border"
              />
            );
          }
          if (block.type === "resource") {
            const res = block.resource || {};
            return (
              <Card key={i}>
                <div className="flex items-center gap-2 flex-wrap">
                  <FileText size={13} className="text-accent shrink-0" />
                  <span className="font-mono text-xs text-text break-all">{res.uri}</span>
                  {res.mimeType && <Badge>{res.mimeType}</Badge>}
                </div>
                {res.text && (
                  <div className="mt-1">
                    <TextBlock text={res.text} />
                  </div>
                )}
              </Card>
            );
          }
          return <CodeBlock key={i} value={block} />;
        })}
        {(!content || content.length === 0) && <div className="text-xs text-comment italic">No content returned.</div>}
      </div>
    );
  }

  function ResourceContents({ contents }: { contents: any[] }) {
    if (!contents?.length) return <div className="text-xs text-comment italic">No contents returned.</div>;
    return (
      <div className="space-y-2">
        {contents.map((c: any, i: number) => (
          <Card key={i}>
            <div className="flex items-center gap-2 flex-wrap">
              <FileText size={13} className="text-accent shrink-0" />
              <span className="font-mono text-xs text-text break-all">{c.uri}</span>
              {c.mimeType && <Badge>{c.mimeType}</Badge>}
            </div>
            {typeof c.text === "string" && (
              <div className="mt-1">
                <TextBlock text={c.text} />
              </div>
            )}
            {c.blob && <div className="text-xs text-comment italic mt-1">Binary data ({Math.round((c.blob.length * 3) / 4)} bytes, base64)</div>}
          </Card>
        ))}
      </div>
    );
  }

  function Messages({ messages }: { messages: any[] }) {
    if (!messages?.length) return <div className="text-xs text-comment italic">No messages returned.</div>;
    return (
      <div className="space-y-2">
        {messages.map((m: any, i: number) => (
          <Card key={i}>
            <Badge>{m.role}</Badge>
            <div className="mt-1.5">
              {m.content?.type === "text" ? (
                <TextBlock text={m.content.text} />
              ) : (
                <CodeBlock value={m.content} />
              )}
            </div>
          </Card>
        ))}
      </div>
    );
  }

  function RequestInfoSection({ requestMetaRaw }: { requestMetaRaw: string }) {
    const meta = tryParse(requestMetaRaw);
    if (!meta) return null;
    const headers: Array<{ key: string; value: string }> = meta.headers || [];
    return (
      <details className="border-t border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs text-comment hover:text-text bg-panel">
          Request sent — {meta.method || "MCP"} {meta.url || ""}
        </summary>
        <div className="p-3 space-y-1" style={SELECTABLE}>
          {headers.length === 0 ? (
            <div className="text-xs text-comment italic">No headers sent.</div>
          ) : (
            <table className="w-full table-fixed text-xs font-mono">
              <tbody>
                {headers.map((h, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="w-1/2 py-1 pr-3 text-comment align-top break-all">{h.key}</td>
                    <td className="w-1/2 py-1 text-text align-top break-all">{h.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>
    );
  }

  const McpResponseComponent = (props: any) => {
    const [showRaw, setShowRaw] = React.useState(false);
    const [copied, setCopied] = React.useState(false);
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    const bodyRaw = props.node.attrs.bodyRaw || "{}";
    const statusCode = props.node.attrs.statusCode ?? 0;
    const parsed = React.useMemo(() => tryParse(bodyRaw), [bodyRaw]);
    const operation = parsed?.operation;
    const transportFailed = statusCode !== 200;
    // The call itself succeeded (HTTP 200) but the tool reported failure via
    // MCP's isError flag — must not read as a plain "OK".
    const toolFailed = !transportFailed && operation === "call_tool" && parsed?.isError === true;

    const handleCopy = async () => {
      try {
        const text = parsed !== null ? JSON.stringify(parsed, null, 2) : bodyRaw;
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {}
    };

    return (
      <NodeViewWrapper>
        <div className="my-2 border border-border rounded overflow-hidden">
          <div
            className={`border-b border-border px-3 py-2 flex items-center justify-between cursor-pointer select-none ${isCollapsed ? "bg-bg" : "bg-panel"} hover:bg-panel`}
            onClick={() => setIsCollapsed((v) => !v)}
          >
            <div className="flex items-center gap-2">
              <ChevronDown
                size={14}
                className="text-comment transition-transform"
                style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
              />
              <Badge tone={transportFailed || toolFailed ? "error" : "success"}>
                {transportFailed ? "Failed" : toolFailed ? "Tool Error" : "OK"}
              </Badge>
              <span className="text-sm font-semibold text-text">{OPERATION_LABELS[operation] || operation || "MCP Response"}</span>
            </div>
            <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono text-comment hover:text-text transition-colors opacity-70 hover:opacity-100"
                style={{ cursor: "pointer", userSelect: "none" }}
                title="Copy response JSON"
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                <span>{copied ? "COPIED" : "COPY"}</span>
              </button>
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono text-comment hover:text-text transition-colors opacity-70 hover:opacity-100"
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                <span>{showRaw ? "PRETTY" : "RAW JSON"}</span>
              </button>
            </div>
          </div>

          {!isCollapsed && (
            <>
              <div className="p-3">
                {parsed === null ? (
                  <ErrorBlock message="Could not parse response body." />
                ) : showRaw ? (
                  <CodeBlock value={parsed} />
                ) : transportFailed || parsed.error ? (
                  <ErrorBlock message={parsed.error || "Request failed."} />
                ) : operation === "list_tools" ? (
                  <ToolsList tools={parsed.tools} />
                ) : operation === "list_resources" ? (
                  <ResourcesList resources={parsed.resources} />
                ) : operation === "list_prompts" ? (
                  <PromptsList prompts={parsed.prompts} />
                ) : operation === "call_tool" ? (
                  <ContentBlocks content={parsed.content} isError={parsed.isError} />
                ) : operation === "read_resource" ? (
                  <ResourceContents contents={parsed.contents} />
                ) : operation === "get_prompt" ? (
                  <Messages messages={parsed.messages} />
                ) : (
                  <CodeBlock value={parsed} />
                )}
              </div>

              <RequestInfoSection requestMetaRaw={props.node.attrs.requestMetaRaw || "{}"} />
            </>
          )}
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "mcp-response",
    group: "block",
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        bodyRaw: { default: "{}" },
        statusCode: { default: 0 },
        elapsedTime: { default: 0 },
        requestMetaRaw: { default: "{}" },
      };
    },

    parseHTML() {
      return [{ tag: "mcp-response" }];
    },

    renderHTML({ HTMLAttributes }: any) {
      return ["div", mergeAttributes(HTMLAttributes, { class: "mcp-response-block" })];
    },

    addNodeView() {
      return ReactNodeViewRenderer(McpResponseComponent);
    },
  });
};

export const McpResponseNode = createMcpResponseNode(
  ({ children }: any) => <div>{children}</div>,
  () => <div>CodeEditor not available</div>
);
