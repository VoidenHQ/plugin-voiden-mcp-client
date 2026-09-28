#!/usr/bin/env node
// Builds the main-process bundle (src/main-process.ts) the app's extension
// loader require()s in the Electron main process. Released as
// dist/<id>-main.cjs; the app's core-plugin updater downloads exactly that
// asset name. The MCP SDK is bundled in; electron and Node built-ins are
// provided by the host.
import { build } from 'esbuild'
import { readFileSync, existsSync } from 'fs'

const manifest = JSON.parse(readFileSync('./manifest.json', 'utf8'))
const pluginId = manifest.id
const entry = './src/main-process.ts'

if (!existsSync(entry)) {
  console.log('No main-process.ts found — skipping main build')
  process.exit(0)
}

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: `dist/${pluginId}-main.cjs`,
  external: ['electron', 'node:*', '@voiden/sdk'],
  minify: true,
})

console.log(`Built dist/${pluginId}-main.cjs`)
