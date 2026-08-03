/**
 * MCP URL Node
 *
 * Inline-content node for the MCP server URL (supports env var highlights).
 */

import React from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewContent, ReactNodeViewRenderer } from "@tiptap/react";
import { Play } from "lucide-react";

export const createMcpUrlNode = (NodeViewWrapper: any, useSendRestRequest?: any) => {
  const McpUrlComponent = (props: any) => {
    const sendRequest = useSendRestRequest ? useSendRestRequest(props.editor) : null;
    const isEditable = props.editor.isEditable;

    return (
      <NodeViewWrapper>
        <div className="bg-panel border-t border-b border-border px-3 py-1.5 flex items-center gap-2">
          <span className="text-xs text-comment font-medium uppercase tracking-wide shrink-0">MCP</span>
          <div
            className={`flex-1 px-2 py-1 bg-editor border border-border rounded text-sm text-text focus-within:outline-none transition-colors font-mono min-h-[28px] ${isEditable ? 'focus-within:border-accent' : 'cursor-default'}`}
          >
            <NodeViewContent />
          </div>
          {sendRequest && (
            <button
              className="flex items-center justify-center w-7 h-7 rounded-md border hover:bg-hover text-status-success transition-colors shrink-0"
              onClick={(e) => {
                sendRequest.refetchFromElement(e.currentTarget as HTMLElement);
              }}
              style={{ borderColor: 'var(--ui-line)', cursor: 'pointer', userSelect: 'none' }}
              title="Send request"
            >
              <Play size={12} />
            </button>
          )}
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "mcpurl",
    group: "",
    content: "inline*",
    atom: false,
    isolating: false,

    parseHTML() {
      return [{ tag: "mcpurl" }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["mcpurl", mergeAttributes(HTMLAttributes), 0];
    },

    addNodeView() {
      return ReactNodeViewRenderer(McpUrlComponent);
    },
  });
};

export const McpUrlNode = createMcpUrlNode(
  ({ children }: any) => <div>{children}</div>
);
