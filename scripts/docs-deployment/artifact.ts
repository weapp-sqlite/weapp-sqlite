import type { DocsChannel } from './identity'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { assertBuildIdentity, assertDeploymentContext, buildIdentity, docsHeaders } from './identity'

/** Shared by the provider adapter and Wrangler's own upload entry point. */
export async function assertDocumentationArtifact(root: string, env: NodeJS.ProcessEnv, channel: DocsChannel) {
  assertDeploymentContext(env, channel)
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const identity = buildIdentity(env, sourceSha)
  const output = path.join(root, 'apps/docs/out')
  assertBuildIdentity(JSON.parse(await readFile(path.join(output, 'docs-build.json'), 'utf8')), identity)
  if (await readFile(path.join(output, '_headers'), 'utf8') !== docsHeaders(channel)) {
    throw new Error('Documentation indexing headers do not match the selected channel; rebuild the selected snapshot.')
  }
  return identity
}
