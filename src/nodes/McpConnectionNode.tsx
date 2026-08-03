/**
 * MCP Connection Node (Container)
 *
 * Non-atom container for mcpurl + mcpoperation child nodes.
 */

import React from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewContent, ReactNodeViewRenderer } from "@tiptap/react";

export const createMcpConnectionNode = (NodeViewWrapper: any, RequestBlockHeader: any) => {
  const McpConnectionComponent = (props: any) => {
    return (
      <NodeViewWrapper>
        <div className="my-2 overflow-hidden">
          <RequestBlockHeader
            title="MCP-CONNECTION"
            withBorder={false}
            editor={props.editor}
            importedDocumentId={props.node.attrs.importedFrom}
            blockType="mcp-connection"
          />
          <NodeViewContent />
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "mcp-connection",
    group: "block",
    content: "(mcpurl mcpoperation)?",
    atom: false,
    isolating: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        importedFrom: { default: undefined },
      };
    },

    parseHTML() {
      return [{ tag: "mcp-connection" }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["mcp-connection", mergeAttributes(HTMLAttributes), 0];
    },

    addNodeView() {
      return ReactNodeViewRenderer(McpConnectionComponent);
    },

    addKeyboardShortcuts() {
      return {
        Backspace: ({ editor }) => {
          const { selection } = editor.state;
          const node = selection.$from.node();
          if (node?.type.name === 'mcp-connection') return true;
          return false;
        },
        Delete: ({ editor }) => {
          const { selection } = editor.state;
          const node = selection.$from.node();
          if (node?.type.name === 'mcp-connection') return true;
          return false;
        },
      };
    },
  });
};

export const McpConnectionNode = createMcpConnectionNode(
  ({ children }: any) => <div>{children}</div>,
  () => <div>Header not available</div>
);
