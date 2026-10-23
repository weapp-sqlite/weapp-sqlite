/* eslint-disable test/no-import-node-test -- Deployment regressions run independently of workspace Vitest projects. */
import type { TestContext } from 'node:test'
import type { CloudflareQuery } from './cloudflare'
import type { BuildIdentity, DocsChannel } from './identity'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { activeMatchingVersion, cloudflareClient, hasCustomDomain, readDeploymentVersion, verifyPublicBuild } from './cloudflare'
import { deployDocumentation } from './deploy'
import { assertBuildIdentity, assertDeploymentContext, buildIdentity, deploymentMessage, docsHeaders, docsTargets, resolveChannel } from './identity'

const sourceSha = 'a'.repeat(40)
const versionId = '12345678-1234-1234-1234-123456789abc'
const otherVersionId = '87654321-1234-1234-1234-123456789abc'
const credentials = { CLOUDFLARE_API_TOKEN: 'private-test-token', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) }

function environment(channel: DocsChannel = 'stable'): NodeJS.ProcessEnv {
  return {
    ...credentials,
    REPO_DOCS_SITE: 'website',
    REPO_DOCS_CHANNEL: channel,
    REPO_DOCS_SOURCE_SHA: sourceSha,
    REPO_DOCS_DEPLOYMENT_ID: 'b'.repeat(64),
    REPO_DOCS_RELEASE_ID: channel === 'stable' ? 'completed-release' : '',
    REPO_DOCS_RESULT_FILE: path.join(tmpdir(), 'docs-result.json'),
    REPO_DOCS_URL: docsTargets[channel].url,
    GITHUB_ACTIONS: 'true',
    GITHUB_RUN_ID: '1',
    REPO_DOCS_CONCURRENCY_GROUP: `docs-website-${channel}`,
  }
}

const identity = buildIdentity(environment())

function provider(message = deploymentMessage(identity), versions = [{ version_id: versionId, percentage: 100 }]): CloudflareQuery {
  return async (_worker, endpoint) => endpoint === 'deployments'
    ? { deployments: [{ created_on: '2026-10-23T00:00:00Z', versions }] }
    : { id: versionId, annotations: { 'workers/message': message } }
}

async function fixture(t: TestContext, channel: DocsChannel = 'stable') {
  const root = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-docs-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', [
    '-c',
    'user.name=Documentation test',
    '-c',
    'user.email=docs@example.test',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=',
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    'Initial documentation source',
  ], { cwd: root })
  const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const env = {
    ...environment(channel),
    REPO_DOCS_SOURCE_SHA: checkoutSha,
    REPO_DOCS_RESULT_FILE: path.join(root, 'result.json'),
  }
  const output = path.join(root, 'apps/docs/out')
  await mkdir(output, { recursive: true })
  const expected = buildIdentity(env)
  await writeFile(path.join(output, 'docs-build.json'), JSON.stringify(expected))
  await writeFile(path.join(output, '_headers'), docsHeaders(channel))
  return { root, env, output, expected }
}

function binding(expected: BuildIdentity) {
  return { hostname: new URL(expected.url).hostname, service: expected.workerName, environment: 'production' }
}

function api(client: CloudflareQuery, expected = identity, domains: () => unknown = () => [binding(expected)]): typeof fetch {
  return async (input, options) => {
    const url = new URL(String(input))
    if (url.origin === expected.url) {
      assert.equal(url.pathname, '/docs-build.json')
      assert.equal(url.searchParams.get('deployment'), expected.deploymentId)
      assert.equal(new Headers(options?.headers).get('Authorization'), null)
      return Response.json(expected)
    }
    if (url.pathname.endsWith('/workers/domains')) {
      assert.equal(url.searchParams.get('hostname'), new URL(expected.url).hostname)
      return Response.json({ success: true, result: domains() })
    }
    const match = url.pathname.match(/\/workers\/scripts\/([^/]+)\/(.*)$/u)
    assert.ok(match, `Unexpected provider URL: ${url.pathname}`)
    const result = await client(match[1]!, match[2]!, true)
    return result === undefined
      ? Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 })
      : Response.json({ success: true, result })
  }
}

function wranglerOutput(channel: DocsChannel, id = versionId) {
  return JSON.stringify({ type: 'deploy', worker_name: docsTargets[channel].worker, wrangler_environment: docsTargets[channel].environment, version_id: id })
}

test('local builds default to preview while partial deployment identities are rejected', () => {
  const local = buildIdentity({}, sourceSha)
  assert.equal(local.channel, 'preview')
  assert.equal(local.url, docsTargets.preview.url)
  assert.equal(local.deploymentId, '')
  assert.throws(() => resolveChannel('production'), /Unknown documentation channel/)
  assert.throws(() => buildIdentity({ REPO_DOCS_CHANNEL: 'stable' }, sourceSha), /Direct website deployment/)
  assert.throws(() => buildIdentity({ REPO_DOCS_SITE: 'website' }, sourceSha), /Direct website deployment/)
  assert.throws(() => buildIdentity({ REPO_DOCS_URL: docsTargets.stable.url }, sourceSha), /URL does not match/)
  assert.throws(() => buildIdentity({}, 'short-sha'), /complete source commit/)
  assert.throws(() => buildIdentity(environment(), 'c'.repeat(40)), /checkout does not match/)
})

test('stable deployment requires the completed release and serialized workflow context', () => {
  const env = environment()
  assert.doesNotThrow(() => assertDeploymentContext(env, 'stable'))
  for (const key of ['REPO_DOCS_RELEASE_ID', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'REPO_DOCS_CONCURRENCY_GROUP']) {
    assert.throws(() => assertDeploymentContext({ ...env, [key]: '' }, 'stable'), /managed docs-website-stable/)
  }
  for (const key of ['REPO_DOCS_SITE', 'REPO_DOCS_SOURCE_SHA', 'REPO_DOCS_DEPLOYMENT_ID', 'REPO_DOCS_RESULT_FILE', 'REPO_DOCS_URL']) {
    assert.throws(() => assertDeploymentContext({ ...env, [key]: '' }, 'stable'), /Direct website deployment/)
  }
  assert.throws(() => assertDeploymentContext({ ...env, REPO_DOCS_RESULT_FILE: 'result.json' }, 'stable'), /Direct website deployment/)
  assert.throws(() => assertDeploymentContext({ ...env, REPO_DOCS_CHANNEL: 'preview' }, 'stable'), /Direct website deployment/)
  assert.throws(() => assertDeploymentContext({ ...environment('preview'), REPO_DOCS_RELEASE_ID: 'stable-release' }, 'preview'), /cannot use a stable/)
})

test('all artifact identity fields must match the requested deployment', () => {
  assert.doesNotThrow(() => assertBuildIdentity(identity, identity))
  for (const key of Object.keys(identity)) {
    assert.throws(() => assertBuildIdentity({ ...identity, [key]: 'mismatch' }, identity), /artifact does not match/)
  }
  assert.throws(() => assertBuildIdentity(null, identity), /artifact does not match/)
  assert.match(docsHeaders('preview'), /X-Robots-Tag: noindex, nofollow, noarchive/u)
  assert.doesNotMatch(docsHeaders('stable'), /noindex/u)
})

test('only the active full-traffic version with the exact identity reconciles a retry', async () => {
  assert.equal(await activeMatchingVersion(provider(), docsTargets.stable.worker, identity), versionId)
  assert.equal(await activeMatchingVersion(provider('another-release'), docsTargets.stable.worker, identity), undefined)
  assert.equal(await activeMatchingVersion(async () => undefined, docsTargets.preview.worker, identity), undefined)
  assert.equal(await activeMatchingVersion(async () => ({ deployments: [] }), docsTargets.preview.worker, identity), undefined)
  await assert.rejects(activeMatchingVersion(provider(undefined, [{ version_id: versionId, percentage: 50 }]), docsTargets.stable.worker, identity), /100%/)
  await assert.rejects(activeMatchingVersion(provider(undefined, [{ version_id: versionId, percentage: 100 }, { version_id: otherVersionId, percentage: 0 }]), docsTargets.stable.worker, identity), /100%/)
  await assert.rejects(activeMatchingVersion(async () => ({}), docsTargets.stable.worker, identity), /invalid deployments/)
  await assert.rejects(activeMatchingVersion(async () => ({ deployments: [{ created_on: 'invalid' }] }), docsTargets.stable.worker, identity), /invalid deployment timestamp/)
  await assert.rejects(activeMatchingVersion(provider(undefined, [{ version_id: 'bad-version', percentage: 100 }]), docsTargets.stable.worker, identity), /invalid active version/)
})

test('a matching historical version cannot replace the current provider evidence', async () => {
  const client: CloudflareQuery = async (_worker, endpoint) => endpoint === 'deployments'
    ? { deployments: [
        { created_on: '2026-10-22T00:00:00Z', versions: [{ version_id: versionId, percentage: 100 }] },
        { created_on: '2026-10-23T00:00:00Z', versions: [{ version_id: otherVersionId, percentage: 100 }] },
      ] }
    : { id: otherVersionId, annotations: { 'workers/message': 'newer-unrelated-deployment' } }
  assert.equal(await activeMatchingVersion(client, docsTargets.stable.worker, identity), undefined)
  await assert.rejects(activeMatchingVersion(async (_worker, endpoint) => endpoint === 'deployments'
    ? { deployments: [{ created_on: '2026-10-23T00:00:00Z', versions: [{ version_id: versionId, percentage: 100 }] }] }
    : { id: otherVersionId }, docsTargets.stable.worker, identity), /does not match the active deployment/)
})

test('Wrangler evidence must contain a valid version for the intended Worker and environment', () => {
  const output = `${wranglerOutput('preview')}\n${wranglerOutput('stable', otherVersionId)}\n`
  assert.equal(readDeploymentVersion(output, docsTargets.preview.worker, 'preview'), versionId)
  assert.equal(readDeploymentVersion(output, docsTargets.stable.worker, ''), otherVersionId)
  assert.throws(() => readDeploymentVersion(output, docsTargets.preview.worker, ''), /did not report/)
  assert.throws(() => readDeploymentVersion(wranglerOutput('stable', 'not-a-uuid'), docsTargets.stable.worker, ''), /did not report/)
  assert.throws(() => readDeploymentVersion('{broken', docsTargets.stable.worker, ''), SyntaxError)
})

test('only an explicit missing Worker permits a first upload; authentication failures stop it', async () => {
  let requestUrl = ''
  const missing = cloudflareClient(credentials, async (url, options) => {
    requestUrl = String(url)
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer private-test-token')
    return Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 })
  })
  assert.equal(await missing(docsTargets.preview.worker, 'deployments', true), undefined)
  assert.match(requestUrl, /workers\/scripts\/weapp-sqlite-docs-preview\/deployments$/u)
  await assert.rejects(missing(docsTargets.stable.worker, 'versions/missing'), /HTTP 404/)
  for (const [status, codes] of [[403, [10000]], [404, [10000]], [404, [10007, 10000]], [500, []]] as const) {
    const denied = cloudflareClient(credentials, async () => Response.json({ success: false, errors: codes.map(code => ({ code })) }, { status }))
    await assert.rejects(denied(docsTargets.stable.worker, 'deployments', true), new RegExp(`HTTP ${status}`))
  }
  const malformed = cloudflareClient(credentials, async () => Response.json({ success: true }))
  await assert.rejects(malformed(docsTargets.stable.worker, 'deployments'), /verification failed/)
  assert.throws(() => cloudflareClient({}), /required to verify/)
})

test('a first preview deployment writes a result only after matching provider confirmation', async (t) => {
  const { root, env, expected } = await fixture(t, 'preview')
  let uploaded = false
  let outputFile = ''
  const result = await deployDocumentation({
    root,
    env,
    channel: 'preview',
    request: api(async (worker, endpoint) => {
      assert.equal(worker, docsTargets.preview.worker)
      return uploaded ? provider(deploymentMessage(expected))(worker, endpoint) : undefined
    }, expected, () => uploaded ? [binding(expected)] : []),
    runWrangler: async (args, cwd, deployEnv) => {
      assert.deepEqual(args, ['exec', 'wrangler', 'deploy', '--env', 'preview', '--message', deploymentMessage(expected)])
      assert.equal(cwd, path.join(root, 'apps/docs'))
      outputFile = deployEnv['WRANGLER_OUTPUT_FILE_PATH']!
      await writeFile(outputFile, wranglerOutput('preview'))
      uploaded = true
    },
  })
  assert.deepEqual(result, { versionId, url: docsTargets.preview.url })
  assert.deepEqual(JSON.parse(await readFile(env['REPO_DOCS_RESULT_FILE']!, 'utf8')), result)
  await assert.rejects(readFile(outputFile), { code: 'ENOENT' })
})

test('an interrupted successful upload is reconciled on retry without uploading again', async (t) => {
  const { root, env, expected } = await fixture(t)
  let uploaded = false
  let attempts = 0
  const options = {
    root,
    env,
    channel: 'stable' as const,
    request: api(async (worker, endpoint) => uploaded ? provider(deploymentMessage(expected))(worker, endpoint) : undefined, expected),
    runWrangler: async () => {
      attempts++
      uploaded = true
      throw new Error('Connection lost after upload')
    },
  }
  await assert.rejects(deployDocumentation(options), /Connection lost/)
  await assert.rejects(readFile(env['REPO_DOCS_RESULT_FILE']!), { code: 'ENOENT' })
  assert.deepEqual(await deployDocumentation(options), { versionId, url: docsTargets.stable.url })
  assert.equal(attempts, 1)
})

test('a successful CLI exit with an unconfirmed active version does not acknowledge deployment', async (t) => {
  const { root, env } = await fixture(t)
  let uploaded = false
  await assert.rejects(deployDocumentation({
    root,
    env,
    channel: 'stable',
    request: api(async (worker, endpoint) => uploaded ? provider('different-deployment')(worker, endpoint) : undefined),
    runWrangler: async (args, _cwd, deployEnv) => {
      assert.equal(args[4], '')
      await writeFile(deployEnv['WRANGLER_OUTPUT_FILE_PATH']!, wranglerOutput('stable'))
      uploaded = true
    },
  }), /not confirmed active/)
  await assert.rejects(readFile(env['REPO_DOCS_RESULT_FILE']!), { code: 'ENOENT' })
})

test('invalid artifacts and indexing headers fail before accessing the provider', async (t) => {
  const { root, env, output, expected } = await fixture(t)
  const unexpectedRequest: typeof fetch = async () => assert.fail('Invalid artifacts must not access Cloudflare')
  await writeFile(path.join(output, 'docs-build.json'), JSON.stringify({ ...expected, channel: 'preview' }))
  await assert.rejects(deployDocumentation({ root, env, channel: 'stable', request: unexpectedRequest }), /artifact does not match/)
  await writeFile(path.join(output, 'docs-build.json'), JSON.stringify(expected))
  await writeFile(path.join(output, '_headers'), docsHeaders('preview'))
  await assert.rejects(deployDocumentation({ root, env, channel: 'stable', request: unexpectedRequest }), /indexing headers/)
})

test('a matching artifact from another checkout fails before accessing the provider', async (t) => {
  const { root, env, output, expected } = await fixture(t)
  const differentSource = 'c'.repeat(40)
  await writeFile(path.join(output, 'docs-build.json'), JSON.stringify({ ...expected, sourceSha: differentSource }))
  await assert.rejects(deployDocumentation({
    root,
    env: { ...env, REPO_DOCS_SOURCE_SHA: differentSource },
    channel: 'stable',
    request: async () => assert.fail('A mismatched checkout must not access Cloudflare'),
    runWrangler: async () => assert.fail('A mismatched checkout must not upload assets'),
  }), /checkout does not match/)
  await assert.rejects(readFile(env.REPO_DOCS_RESULT_FILE), { code: 'ENOENT' })
})

test('provider permission errors prevent Wrangler from running', async (t) => {
  const { root, env } = await fixture(t)
  await assert.rejects(deployDocumentation({
    root,
    env,
    channel: 'stable',
    request: async () => Response.json({ success: false, errors: [{ code: 10000 }] }, { status: 403 }),
    runWrangler: async () => assert.fail('Permission errors must not trigger an upload'),
  }), /HTTP 403/)
  await assert.rejects(readFile(env['REPO_DOCS_RESULT_FILE']!), { code: 'ENOENT' })
})

test('custom domain verification requires the expected Worker production environment', async () => {
  const domainApi = (result: unknown): typeof fetch => async () => Response.json({ success: true, result })
  assert.equal(await hasCustomDomain(credentials, identity, domainApi([])), false)
  assert.equal(await hasCustomDomain(credentials, identity, domainApi([binding(identity)])), true)
  for (const invalid of [
    [{ ...binding(identity), service: 'another-worker' }],
    [{ ...binding(identity), environment: 'preview' }],
    [{ hostname: new URL(identity.url).hostname }],
  ]) {
    await assert.rejects(hasCustomDomain(credentials, identity, domainApi(invalid)), /another Worker or service environment/)
  }
  await assert.rejects(hasCustomDomain(credentials, identity, domainApi([binding(identity), binding(identity)])), /multiple bindings/)
  await assert.rejects(hasCustomDomain(credentials, identity, domainApi({})), /invalid custom domains/)
  await assert.rejects(hasCustomDomain(credentials, identity, async () => Response.json({ success: false, errors: [{ code: 10000 }] }, { status: 403 })), /HTTP 403/)
})

test('an active upload with a missing domain resumes only trigger deployment', async (t) => {
  const { root, env, expected } = await fixture(t, 'preview')
  let domainBound = false
  const commands: string[][] = []
  const result = await deployDocumentation({
    root,
    env,
    channel: 'preview',
    request: api(provider(deploymentMessage(expected)), expected, () => domainBound ? [binding(expected)] : []),
    runWrangler: async (args) => {
      commands.push(args)
      domainBound = true
    },
  })
  assert.deepEqual(commands, [['exec', 'wrangler', 'triggers', 'deploy', '--env', 'preview']])
  assert.deepEqual(result, { versionId, url: expected.url })
})

test('a trigger failure leaves the deployment incomplete and retry finishes without uploading', async (t) => {
  const { root, env, expected } = await fixture(t)
  let domainBound = false
  let attempts = 0
  const options = {
    root,
    env,
    channel: 'stable' as const,
    request: api(provider(deploymentMessage(expected)), expected, () => domainBound ? [binding(expected)] : []),
    runWrangler: async (args: string[]) => {
      assert.deepEqual(args, ['exec', 'wrangler', 'triggers', 'deploy', '--env', ''])
      if (++attempts === 1) {
        throw new Error('Custom domain provisioning was interrupted')
      }
      domainBound = true
    },
  }
  await assert.rejects(deployDocumentation(options), /provisioning was interrupted/)
  await assert.rejects(readFile(env.REPO_DOCS_RESULT_FILE), { code: 'ENOENT' })
  assert.equal((await deployDocumentation(options)).versionId, versionId)
  assert.equal(attempts, 2)
})

test('an existing domain owned by another Worker is never overwritten', async (t) => {
  const { root, env, expected } = await fixture(t)
  await assert.rejects(deployDocumentation({
    root,
    env,
    channel: 'stable',
    request: api(provider(deploymentMessage(expected)), expected, () => [{ ...binding(expected), service: 'unrelated-worker' }]),
    runWrangler: async () => assert.fail('A conflicting domain must not trigger provider writes'),
  }), /another Worker or service environment/)
  await assert.rejects(readFile(env.REPO_DOCS_RESULT_FILE), { code: 'ENOENT' })
})

test('a missing domain after upload is repaired and verified independently of the version upload', async (t) => {
  const { root, env, expected } = await fixture(t)
  let uploaded = false
  let domainBound = false
  const commands: string[][] = []
  await deployDocumentation({
    root,
    env,
    channel: 'stable',
    request: api(
      async (worker, endpoint) => uploaded ? provider(deploymentMessage(expected))(worker, endpoint) : undefined,
      expected,
      () => domainBound ? [binding(expected)] : [],
    ),
    runWrangler: async (args, _cwd, deployEnv) => {
      commands.push(args)
      if (args[2] === 'deploy') {
        uploaded = true
        await writeFile(deployEnv['WRANGLER_OUTPUT_FILE_PATH']!, wranglerOutput('stable'))
      }
      else {
        assert.equal(args[2], 'triggers')
        domainBound = true
      }
    },
  })
  assert.equal(commands.length, 2)
  assert.equal(commands[0]![2], 'deploy')
  assert.equal(commands[1]![2], 'triggers')
  assert.equal(JSON.parse(await readFile(env.REPO_DOCS_RESULT_FILE, 'utf8')).versionId, versionId)
})

test('successful trigger exit cannot acknowledge a domain that is still absent', async (t) => {
  const { root, env, expected } = await fixture(t)
  await assert.rejects(deployDocumentation({
    root,
    env,
    channel: 'stable',
    request: api(provider(deploymentMessage(expected)), expected, () => []),
    runWrangler: async args => assert.equal(args[2], 'triggers'),
  }), /not confirmed after trigger deployment/)
  await assert.rejects(readFile(env.REPO_DOCS_RESULT_FILE), { code: 'ENOENT' })
})

test('public artifact verification tolerates bounded propagation and bypasses stale caches', async () => {
  let attempts = 0
  const delays: number[] = []
  await verifyPublicBuild(identity, async (input, options) => {
    const url = new URL(String(input))
    assert.equal(url.origin, identity.url)
    assert.equal(url.searchParams.get('deployment'), identity.deploymentId)
    assert.equal(options?.cache, 'no-store')
    assert.equal(options?.redirect, 'error')
    assert.equal(new Headers(options?.headers).get('Authorization'), null)
    return ++attempts < 3 ? Response.json({ ...identity, deploymentId: 'older-build' }) : Response.json(identity)
  }, async delay => delays.push(delay))
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [1_000, 2_000])
})

test('an active version and domain without the public build do not produce a success receipt', async (t) => {
  const { root, env, expected } = await fixture(t)
  const controlPlane = api(provider(deploymentMessage(expected)), expected)
  let attempts = 0
  await assert.rejects(deployDocumentation({
    root,
    env,
    channel: 'stable',
    request: async (input, options) => {
      if (new URL(String(input)).origin === expected.url) {
        attempts++
        return Response.json({ error: 'Domain is still propagating' }, { status: 503 })
      }
      return controlPlane(input, options)
    },
    sleep: async () => {},
    runWrangler: async () => assert.fail('Readiness retries must not reupload an active Worker'),
  }), /not serving the selected build yet/)
  assert.equal(attempts, 5)
  await assert.rejects(readFile(env.REPO_DOCS_RESULT_FILE), { code: 'ENOENT' })
})
