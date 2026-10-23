import type { DocsChannel } from './identity'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
// eslint-disable-next-line e18e/ban-dependencies -- Resolve pnpm consistently on Windows for this fixed dry-run command.
import { execa } from 'execa'
import { docsTargets, resolveChannel } from './identity'

interface WranglerConfiguration {
  $schema?: string
  name: string
  main: string
  assets: { directory: string }
  build?: unknown
  env?: Record<string, Partial<WranglerConfiguration>>
}

export interface DryRunDocumentationOptions {
  root?: string
  runWrangler?: (args: string[], cwd: string) => Promise<void>
}

/** Validate Wrangler packaging without creating release credentials or permitting a real upload. */
export async function dryRunDocumentation(channel: DocsChannel, options: DryRunDocumentationOptions = {}) {
  const root = options.root ?? fileURLToPath(new URL('../../', import.meta.url))
  const website = path.join(root, 'apps/docs')
  const original = JSON.parse(await readFile(path.join(website, 'wrangler.jsonc'), 'utf8')) as WranglerConfiguration
  const environment = docsTargets[channel].environment
  const selected = { ...original, ...(environment ? original.env?.[environment] : {}) }
  if (selected.name !== docsTargets[channel].worker) {
    throw new Error('Wrangler dry-run configuration does not match the selected documentation channel.')
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-docs-dry-run-'))
  try {
    // Only this short-lived copy omits the guard. No override environment variable exists.
    delete selected.$schema
    delete selected.build
    delete selected.env
    selected.main = path.resolve(website, selected.main)
    selected.assets = { ...selected.assets, directory: path.resolve(website, selected.assets.directory) }
    const filename = path.join(temporary, 'wrangler.json')
    await writeFile(filename, `${JSON.stringify(selected)}\n`)
    const args = ['exec', 'wrangler', 'deploy', '--dry-run', '--config', filename, '--env', '']
    if (options.runWrangler) {
      await options.runWrangler(args, website)
    }
    else {
      await execa('pnpm', args, { cwd: website, stdio: 'inherit' })
    }
  }
  finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 3) {
    throw new Error('Only the preview or stable channel may be passed to the documentation dry-run.')
  }
  await dryRunDocumentation(resolveChannel(process.argv[2]))
}
