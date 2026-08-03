/**
 * Voiden MCP Client — headless runner.
 *
 * Only builds the request object (url/headers/mcp-operation config) — actual
 * execution (the MCP connect+call handshake) happens later, shared with the
 * app, inside @voiden/executors' secureRequest.ts.
 */

import type { RunnerFactory, RunnerContext, Block, CliRequestState } from '@voiden/sdk/runner'
import { resolveMcpBlock } from './lib/mcpBlocks'

type RestApiRequestState = CliRequestState

export function buildRequest(blocks: Block[]): RestApiRequestState | null {
  const cfg = resolveMcpBlock(blocks as any[])
  if (!cfg) return null

  const headers: Array<{ key: string; value: string; enabled: boolean }> = []
  const headersBlock = blocks.find((b: any) => b.type === 'headers-table')
  if (headersBlock && Array.isArray(headersBlock.content)) {
    for (const child of headersBlock.content as any[]) {
      if (child.type === 'table' && Array.isArray((child as any).rows)) {
        for (const r of (child as any).rows) {
          if (!r.attrs?.disabled && Array.isArray(r.row) && r.row[0]) {
            headers.push({ key: String(r.row[0]).trim(), value: String(r.row[1] ?? '').trim(), enabled: true })
          }
        }
      }
    }
  }

  return {
    method: 'MCP',
    url: cfg.url,
    headers,
    queryParams: [],
    pathParams: [],
    metadata: { operation: cfg.operation },
    // Cast: CliRequestState doesn't declare `protocolType`/`mcp` yet — same
    // pattern voiden-graphql's runner.ts uses for its own protocol-specific fields.
    ...({
      protocolType: 'mcp',
      mcp: {
        operation: cfg.operation,
        toolName: cfg.toolName,
        toolArgs: cfg.toolArgs,
        resourceUri: cfg.resourceUri,
        promptName: cfg.promptName,
        promptArgs: cfg.promptArgs,
      },
    } as any),
  }
}

const createMcpClientRunner: RunnerFactory = (context: RunnerContext) => {
  return {
    onload() {
      ;(context as any).registerRequestContainer?.({
        type: 'mcp-connection',
        urlType: 'mcpurl',
        defaultMethod: 'MCP',
      })

      context.onBuildRequest((request, blocks) => {
        const built = buildRequest(blocks)
        if (!built) return request
        const priorHeaders = Array.isArray((request as any)?.headers) ? (request as any).headers : []
        return {
          ...built,
          headers: [...priorHeaders, ...built.headers],
        }
      })
    },
  }
}

export default createMcpClientRunner
