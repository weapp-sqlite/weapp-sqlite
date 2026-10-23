import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
// eslint-disable-next-line e18e/ban-dependencies -- Resolve pnpm consistently on Windows and propagate build failures.
import { execa } from 'execa'
import { buildIdentity, docsHeaders } from './identity'

export async function buildDocumentation(root = fileURLToPath(new URL('../../', import.meta.url)), env = process.env) {
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const identity = buildIdentity(env, sourceSha)
  await execa('pnpm', ['--filter', '@weapp-sqlite/docs', 'run', 'build'], {
    cwd: root,
    env: { ...env, REPO_DOCS_CHANNEL: identity.channel, REPO_DOCS_URL: identity.url },
    stdio: 'inherit',
  })
  const output = path.join(root, 'apps/docs/out')
  await writeFile(path.join(output, 'docs-build.json'), `${JSON.stringify(identity)}\n`)
  await writeFile(path.join(output, '_headers'), docsHeaders(identity.channel))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildDocumentation()
}
