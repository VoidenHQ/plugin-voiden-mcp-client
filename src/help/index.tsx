export const McpConnectionHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">MCP Connection</h3>
      <p className="text-sm text-comment mb-3">
        Connects to an MCP (Model Context Protocol) server over HTTP — remote or running
        locally (e.g. <code className="bg-accent/10 px-1 rounded text-text">http://localhost:3000/mcp</code>) — and
        calls one of its tools, resources, or prompts, the same way this file already tests
        REST or GraphQL requests. Phase 1 supports Streamable-HTTP servers only — a server
        launched by command (stdio, e.g. <code className="bg-accent/10 px-1 rounded text-text">npx some-mcp-server</code>) isn't
        supported yet.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How to Use</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-comment">
        <li>Insert with <code className="bg-accent/10 px-1 rounded text-text">/mcp-client</code></li>
        <li>Set the server URL — the Operation block below automatically discovers what the server offers as soon as a URL is present</li>
        <li>Pick Tool / Resource / Prompt, then pick the specific one from the dropdown it discovered</li>
        <li>Add an <strong>Auth</strong> block in the same section if the server requires authentication</li>
        <li>Run with Cmd+Enter (Mac) / Ctrl+Enter (Windows/Linux), or the Play button</li>
      </ol>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Paste a server config</h4>
      <p className="text-sm text-comment mb-1">
        Paste a <code className="bg-accent/10 px-1 rounded text-text">{'{"mcpServers": {...}}'}</code> config
        (the format Claude Desktop / Cursor / VS Code / Windsurf use) anywhere in the file — it
        fills in the URL and headers automatically. Only the first server entry with a
        "url" field is used; a "command"-based (local process) entry can't be applied yet.
      </p>
    </section>
  </div>
);

export const McpOperationHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">MCP Operation</h3>
      <p className="text-sm text-comment mb-3">
        Picks which capability to call on the connected MCP server. As soon as the connection's
        URL is filled in, this block silently asks the server what it offers and populates the
        dropdown below — no need to type tool/resource/prompt names by hand.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Type</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-comment">
        <li><strong>Tool</strong> — pick a tool from the list, then fill in its arguments (auto-filled from its schema when you select it). Calls it directly — no separate "list" step to run.</li>
        <li><strong>Resource</strong> — pick a resource from the list. No arguments needed; the picked URI is the whole input.</li>
        <li><strong>Prompt</strong> — pick a prompt from the list, then fill in its arguments (auto-filled with empty placeholders when you select it).</li>
      </ul>
      <p className="text-xs text-comment mt-2">
        If discovery can't reach the server yet (or the server doesn't support listing), use
        "Enter manually" next to the dropdown to type the name/URI directly — the block still
        works without discovery, you just lose the auto-fill convenience.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Example (Tool arguments)</h4>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text">
{`{
  "email": "{{USER_EMAIL}}"
}`}
      </pre>
    </section>
  </div>
);
