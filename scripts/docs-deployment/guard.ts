import type { DocsChannel } from './identity'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertDocumentationArtifact } from './artifact'
import { resolveChannel } from './identity'

export async function guardWranglerBuild(channel: DocsChannel, env = process.env, root = fileURLToPath(new URL('../../', import.meta.url))) {
  const command = env['WRANGLER_COMMAND']
  if (command === 'dev' || command === 'types') {
    return
  }
  if (command !== 'deploy' && command !== 'versions upload') {
    throw new Error(`Unsupported Wrangler build command: ${command ?? '(missing)'}`)
  }
  await assertDocumentationArtifact(root, env, channel)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || process.argv.length !== 3) {
    throw new Error('Wrangler must select the documentation channel configured for this environment.')
  }
  await guardWranglerBuild(resolveChannel(process.argv[2]))
}
