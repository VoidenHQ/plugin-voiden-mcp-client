/**
 * MCP Client — main-process part.
 *
 * Owns the "Authorize" flow for mcp-connection blocks: a real OAuth 2.1
 * handshake (discovery, Dynamic Client Registration, PKCE, token exchange —
 * all done by the MCP SDK's auth()) against someone else's MCP server, with
 * a loopback listener to receive the browser's redirect and the system
 * browser for the login page.
 *
 * Lives here, not in core, so fixes to it ship as a plugin release. Loaded
 * by the app's main-process extension loader; the renderer reaches it via
 * window.electron.ipc.invoke('ext:voiden-mcp-client:authorize', { serverUrl }).
 *
 * Executing MCP operations stays in core (@voiden/executors' mcp.ts), which
 * attaches the saved token from ~/.voiden/mcp-client-oauth.json on every
 * call — so the file format below is a contract with core and must not
 * change: { clients: { [origin]: clientInfo }, tokens: { [origin]: tokens } },
 * tokens carrying an absolute `expiresAt` (seconds since epoch).
 */

import type { ElectronExtensionContext } from '@voiden/sdk/electron'
import { createServer, type Server } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

// Provided by the Electron main process this runs in (never bundled, and
// not a dependency of this plugin — hence untyped).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BrowserWindow } = require('electron') as { BrowserWindow: any }
type BrowserWindow = any

// ─── Token store (~/.voiden/mcp-client-oauth.json) ──────────────────────────

interface StoredTokens {
  access_token: string
  token_type: string
  refresh_token?: string
  expiresAt?: number
  scope?: string
}

interface Store {
  clients: Record<string, OAuthClientInformationFull>
  tokens: Record<string, StoredTokens>
}

const STORE_DIR = join(homedir(), '.voiden')
const STORE_PATH = join(STORE_DIR, 'mcp-client-oauth.json')

function readStore(): Store {
  if (!existsSync(STORE_PATH)) return { clients: {}, tokens: {} }
  try {
    const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf-8'))
    return { clients: parsed.clients ?? {}, tokens: parsed.tokens ?? {} }
  } catch {
    return { clients: {}, tokens: {} }
  }
}

function writeStore(store: Store): void {
  mkdirSync(STORE_DIR, { recursive: true })
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 })
  try { chmodSync(STORE_PATH, 0o600) } catch { /* best-effort */ }
}

/** One registration per server origin, regardless of path — same key core reads by. */
function originKey(serverUrl: string): string {
  try {
    return new URL(serverUrl).origin
  } catch {
    return serverUrl
  }
}

function updateStore(serverUrl: string, fn: (store: Store, key: string) => void): void {
  const store = readStore()
  fn(store, originKey(serverUrl))
  writeStore(store)
}

// ─── OAuthClientProvider for the SDK's auth() ──────────────────────────────

class McpOAuthProvider implements OAuthClientProvider {
  private codeVerifierValue: string | undefined

  constructor(
    private readonly serverUrl: string,
    private readonly redirectUrlValue: string,
    private readonly onRedirect: (authorizationUrl: string) => void,
  ) {}

  get redirectUrl(): string {
    return this.redirectUrlValue
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Voiden',
      redirect_uris: [this.redirectUrlValue],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return readStore().clients[originKey(this.serverUrl)]
  }

  saveClientInformation(info: OAuthClientInformationFull): void {
    updateStore(this.serverUrl, (s, k) => { s.clients[k] = info })
  }

  tokens(): OAuthTokens | undefined {
    const stored = readStore().tokens[originKey(this.serverUrl)]
    if (!stored) return undefined
    // Stored as absolute expiresAt; the SDK wants relative expires_in.
    const expires_in = stored.expiresAt !== undefined
      ? Math.max(0, stored.expiresAt - Math.floor(Date.now() / 1000))
      : undefined
    return {
      access_token: stored.access_token,
      token_type: stored.token_type as 'Bearer',
      refresh_token: stored.refresh_token,
      scope: stored.scope,
      expires_in,
    }
  }

  saveTokens(tokens: OAuthTokens): void {
    updateStore(this.serverUrl, (s, k) => {
      s.tokens[k] = {
        access_token: tokens.access_token,
        token_type: tokens.token_type,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        expiresAt: tokens.expires_in !== undefined ? Math.floor(Date.now() / 1000) + tokens.expires_in : undefined,
      }
    })
  }

  /** Called by auth() when the server rejects what's stored — a revoked
   *  refresh token (invalid_grant → 'tokens'), or a registration it no
   *  longer knows (invalid_client → 'all') — right before it retries once.
   *  Without this the retry re-read the same rejected values and failed
   *  identically, so a server-side revoke could never be recovered from. */
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    updateStore(this.serverUrl, (s, k) => {
      if (scope === 'all' || scope === 'client') delete s.clients[k]
      if (scope === 'all' || scope === 'tokens') delete s.tokens[k]
    })
    if (scope === 'all' || scope === 'verifier') this.codeVerifierValue = undefined
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.onRedirect(authorizationUrl.toString())
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.codeVerifierValue = codeVerifier
  }

  codeVerifier(): string {
    if (!this.codeVerifierValue) throw new Error('No PKCE code verifier saved for this authorization attempt.')
    return this.codeVerifierValue
  }
}

// ─── Loopback listener (RFC 8252) ──────────────────────────────────────────

// Long enough for a real login (SSO, "check your email"); short enough that
// an abandoned attempt doesn't leave a port listening forever.
const AUTHORIZE_TIMEOUT_MS = 5 * 60 * 1000

interface CallbackResult {
  code?: string
  error?: string
}

function renderCallbackPage(success: boolean, error?: string): string {
  const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
  const heading = success ? 'Authorized' : 'Authorization failed'
  const body = success
    ? 'You can close this tab and go back to Voiden.'
    : `Something went wrong: ${escape(error || 'unknown error')}. You can close this tab and try again from Voiden.`
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Voiden</title>
<style>
  body { font: 15px -apple-system, system-ui, sans-serif; background: #0b0b0c; color: #e4e4e7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; max-width: 420px; padding: 0 24px; }
  .icon { font-size: 32px; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? '✓' : '✗'}</div>
    <h2>${heading}</h2>
    <p>${body}</p>
  </div>
</body>
</html>`
}

/** Listens on an OS-assigned port, so the exact redirect_uri is known before
 *  registration. `onCallbackReceived` fires once, as soon as the browser
 *  lands here (after the response page is sent). */
function startLoopbackListener(onCallbackReceived: () => void): Promise<{
  server: Server
  port: number
  waitForCallback: () => Promise<CallbackResult>
}> {
  return new Promise((resolve, reject) => {
    let settled = false
    let resolveCallback: (v: CallbackResult) => void
    const callbackPromise = new Promise<CallbackResult>((res) => { resolveCallback = res })

    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code') || undefined
      const errorParam = url.searchParams.get('error') || undefined
      const errorDescription = url.searchParams.get('error_description') || undefined
      const error = errorParam ? (errorDescription || errorParam) : undefined
      res.writeHead(200, { 'content-type': 'text/html' }).end(renderCallbackPage(!!code, error))
      if (!settled) {
        settled = true
        try { onCallbackReceived() } catch { /* never let refocusing break the auth result */ }
        resolveCallback({ code, error })
      }
    })

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        resolveCallback({ error: 'Timed out waiting for the browser to complete authorization (5 minutes).' })
      }
    }, AUTHORIZE_TIMEOUT_MS)

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port, waitForCallback: () => callbackPromise.finally(() => clearTimeout(timeout)) })
    })
  })
}

// ─── The flow ──────────────────────────────────────────────────────────────

export interface AuthorizeResult {
  success: boolean
  error?: string
}

export async function authorizeMcpServer(
  serverUrl: string,
  openBrowser: (url: string) => void,
  onCallbackReceived: () => void,
): Promise<AuthorizeResult> {
  const { server, waitForCallback, port } = await startLoopbackListener(onCallbackReceived)
  const redirectUrl = `http://127.0.0.1:${port}/callback`
  try {
    // The browser is opened below, not from inside auth(), so a login URL
    // built from a stale registration can be thrown away unseen.
    let loginUrl: string | undefined
    const captureLoginUrl = (url: string) => { loginUrl = url }

    // Saved tokens still work (or refresh) → done, no browser. A revoked
    // refresh token or unknown client makes the SDK call
    // invalidateCredentials() and retry, ending up here as 'REDIRECT'.
    const hadSavedRegistration = !!readStore().clients[originKey(serverUrl)]
    let provider = new McpOAuthProvider(serverUrl, redirectUrl, captureLoginUrl)
    if (await auth(provider, { serverUrl }) === 'AUTHORIZED') return { success: true }

    // A browser login is needed. If it would reuse a registration saved
    // earlier, register fresh instead: the server may have revoked or
    // forgotten it, and that only fails on the server's own login page
    // ("Invalid client_id") — in the browser, where Voiden never sees it.
    if (hadSavedRegistration) {
      updateStore(serverUrl, (s, k) => { delete s.clients[k]; delete s.tokens[k] })
      loginUrl = undefined
      provider = new McpOAuthProvider(serverUrl, redirectUrl, captureLoginUrl)
      if (await auth(provider, { serverUrl }) === 'AUTHORIZED') return { success: true }
    }
    if (!loginUrl) return { success: false, error: 'The server did not return a login page to open.' }
    openBrowser(loginUrl)

    const { code, error: callbackError } = await waitForCallback()
    if (callbackError) return { success: false, error: callbackError }
    if (!code) return { success: false, error: 'No authorization code was received from the browser.' }

    if (await auth(provider, { serverUrl, authorizationCode: code }) !== 'AUTHORIZED') {
      return { success: false, error: 'The server did not accept the token exchange.' }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  } finally {
    server.close()
  }
}

/** Brings the window whose block the user clicked Authorize on back to the
 *  front once the browser hands control back — not whichever window happens
 *  to be focused by then. Same steps as core's forceRefocusWindow. */
function refocus(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  if (process.platform === 'win32') {
    setImmediate(() => {
      if (win.isDestroyed()) return
      win.blur()
      win.setAlwaysOnTop(true)
      win.setAlwaysOnTop(false)
      win.focus()
      win.webContents.focus()
    })
    return
  }
  win.focus()
  win.webContents.focus()
}

export default function createMcpClientMainPlugin(context: ElectronExtensionContext) {
  return {
    onload() {
      context.ipc.handle('authorize', async (event: { sender: unknown }, { serverUrl }: { serverUrl: string }) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        return authorizeMcpServer(serverUrl, (url) => { void context.shell.openExternal(url) }, () => refocus(win))
      })
    },
    onunload() {
      context.ipc.removeHandler('authorize')
    },
  }
}
