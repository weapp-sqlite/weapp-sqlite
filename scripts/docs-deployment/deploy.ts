import type { DocsChannel } from './identity'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
// eslint-disable-next-line e18e/ban-dependencies -- Deployment needs the same cross-platform pnpm command resolution as the build.
import { execa } from 'execa'
import { assertDocumentationArtifact } from './artifact'
import { activeMatchingVersion, cloudflareClient, hasCustomDomain, readDeploymentVersion, verifyPublicBuild } from './cloudflare'
import { deploymentMessage, docsTargets, resolveChannel } from './identity'

export interface DeployDocumentationOptions {
  channel: DocsChannel
  root?: string
  env?: NodeJS.ProcessEnv
  request?: typeof fetch
  sleep?: (milliseconds: number) => Promise<unknown>
  runWrangler?: (args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<void>
}

export async function deployDocumentation(options: DeployDocumentationOptions) {
  const { channel } = options
  const env = options.env ?? process.env
  const root = options.root ?? fileURLToPath(new URL('../../', import.meta.url))
  const website = path.join(root, 'apps/docs')
  const identity = await assertDocumentationArtifact(root, env, channel)
  const target = docsTargets[channel]
  const client = cloudflareClient(env, options.request)
  let versionId = await activeMatchingVersion(client, target.worker, identity)
  let domainBound = await hasCustomDomain(env, identity, options.request)
  const runWrangler = async (args: string[], commandEnv = env) => {
    if (options.runWrangler) {
      await options.runWrangler(args, website, commandEnv)
    }
    else {
      await execa('pnpm', args, { cwd: website, env: commandEnv, stdio: 'inherit' })
    }
  }
  if (!versionId) {
    const temporary = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-docs-deploy-'))
    const outputFile = path.join(temporary, 'wrangler.jsonl')
    try {
      const args = ['exec', 'wrangler', 'deploy', '--env', target.environment, '--message', deploymentMessage(identity)]
      const deployEnv = { ...env, WRANGLER_OUTPUT_FILE_PATH: outputFile }
      await runWrangler(args, deployEnv)
      versionId = readDeploymentVersion(await readFile(outputFile, 'utf8'), target.worker, target.environment)
      if (await activeMatchingVersion(client, target.worker, identity) !== versionId) {
        throw new Error('The uploaded documentation version is not confirmed active; retry this same deployment.')
      }
      domainBound = await hasCustomDomain(env, identity, options.request)
    }
    finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
  if (!domainBound) {
    // Upload and trigger deployment are separate provider operations. Resume only the missing stage.
    await runWrangler(['exec', 'wrangler', 'triggers', 'deploy', '--env', target.environment])
    if (await activeMatchingVersion(client, target.worker, identity) !== versionId
      || !await hasCustomDomain(env, identity, options.request)) {
      throw new Error('Documentation version or custom domain is not confirmed after trigger deployment; retry this same deployment.')
    }
  }
  await verifyPublicBuild(identity, options.request, options.sleep)
  const result = { versionId, url: target.url }
  await writeFile(env['REPO_DOCS_RESULT_FILE']!, `${JSON.stringify(result)}\n`)
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) {
    throw new Error('Select the documentation deployment channel: preview or stable.')
  }
  console.log(JSON.stringify(await deployDocumentation({ channel: resolveChannel(process.argv[2]) })))
}
