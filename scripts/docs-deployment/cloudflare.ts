import type { BuildIdentity } from './identity'
import { setTimeout } from 'node:timers/promises'
import { assertBuildIdentity, deploymentMessage } from './identity'

export type CloudflareQuery = (worker: string, endpoint: string, allowMissing?: boolean) => Promise<unknown>

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function isVersionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(value)
}

function accountClient(env: NodeJS.ProcessEnv, request: typeof fetch) {
  const token = env['CLOUDFLARE_API_TOKEN']
  const account = env['CLOUDFLARE_ACCOUNT_ID']
  if (!token?.trim() || !/^[a-f\d]{32}$/iu.test(account ?? '')) {
    throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required to verify documentation deployments.')
  }
  return async (endpoint: string, allowMissing = false) => {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${account}/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    })
    const payload = record(await response.json())
    const errors = Array.isArray(payload?.['errors']) ? payload['errors'] : []
    const codes = errors.map(error => record(error)?.['code'])
    if (allowMissing && response.status === 404 && codes.length > 0 && codes.every(code => code === 10007)) {
      return undefined
    }
    if (!response.ok || payload?.['success'] !== true || !Object.hasOwn(payload, 'result')) {
      throw new Error(`Cloudflare ${endpoint} verification failed (HTTP ${response.status}, codes: ${codes.join(', ')}).`)
    }
    return payload['result']
  }
}

export function cloudflareClient(env: NodeJS.ProcessEnv, request: typeof fetch = fetch): CloudflareQuery {
  const query = accountClient(env, request)
  return (worker, endpoint, allowMissing) => query(`workers/scripts/${encodeURIComponent(worker)}/${endpoint}`, allowMissing)
}

/** Wrangler named environments create separate Workers, each with the production service environment. */
export async function hasCustomDomain(env: NodeJS.ProcessEnv, identity: BuildIdentity, request: typeof fetch = fetch) {
  const hostname = new URL(identity.url).hostname
  const domains = await accountClient(env, request)(`workers/domains?hostname=${encodeURIComponent(hostname)}`)
  if (!Array.isArray(domains) || domains.some(domain => !record(domain) || typeof domain.hostname !== 'string')) {
    throw new Error('Cloudflare returned an invalid custom domains response.')
  }
  const matches = domains.filter(domain => domain.hostname === hostname)
  if (matches.length > 1) {
    throw new Error(`Cloudflare returned multiple bindings for documentation hostname ${hostname}.`)
  }
  const domain = matches[0] as Record<string, unknown> | undefined
  if (!domain) {
    return false
  }
  if (domain['service'] !== identity.workerName || domain['environment'] !== 'production') {
    throw new Error(`Documentation hostname ${hostname} is bound to another Worker or service environment; reconcile that binding before retrying.`)
  }
  return true
}

/** Control-plane success can precede DNS, certificate and asset propagation. */
export async function verifyPublicBuild(identity: BuildIdentity, request: typeof fetch = fetch, sleep: (milliseconds: number) => Promise<unknown> = setTimeout) {
  const url = new URL('/docs-build.json', identity.url)
  url.searchParams.set('deployment', identity.deploymentId)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await request(url, {
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      assertBuildIdentity(await response.json(), identity)
      return
    }
    catch {
      if (attempt === 4) {
        throw new Error(`Documentation at ${identity.url} is not serving the selected build yet; retry this same deployment after domain and asset propagation completes.`)
      }
      await sleep(1_000 * 2 ** attempt)
    }
  }
}

/** A historical upload or a partial rollout cannot acknowledge this deployment. */
export async function activeMatchingVersion(client: CloudflareQuery, worker: string, identity: BuildIdentity) {
  const result = await client(worker, 'deployments', true)
  if (result === undefined) {
    return undefined
  }
  const deployments = record(result)?.['deployments']
  if (!Array.isArray(deployments)) {
    throw new TypeError('Cloudflare returned an invalid deployments response.')
  }
  const ordered = deployments.map((value: unknown) => {
    const deployment = record(value)
    const createdOn = deployment?.['created_on']
    const timestamp = typeof createdOn === 'string' ? Date.parse(createdOn) : Number.NaN
    if (!deployment || !Number.isFinite(timestamp)) {
      throw new TypeError('Cloudflare returned an invalid deployment timestamp.')
    }
    return { deployment, timestamp }
  }).sort((a, b) => b.timestamp - a.timestamp)
  const deployment = ordered[0]?.deployment
  if (!deployment) {
    return undefined
  }
  const versions = deployment['versions']
  if (!Array.isArray(versions) || versions.length !== 1 || record(versions[0])?.['percentage'] !== 100) {
    throw new Error('Documentation Worker must have exactly one active version receiving 100% of traffic.')
  }
  const versionId = record(versions[0])?.['version_id']
  if (!isVersionId(versionId)) {
    throw new Error('Cloudflare returned an invalid active version ID.')
  }
  const version = record(await client(worker, `versions/${versionId}`))
  if (version?.['id'] !== versionId) {
    throw new Error('Cloudflare returned a version that does not match the active deployment.')
  }
  return record(version['annotations'])?.['workers/message'] === deploymentMessage(identity) ? versionId : undefined
}

export function readDeploymentVersion(output: string, worker: string, environment: string) {
  const entries = output.split(/\r?\n/u).filter(line => line.trim()).map(line => record(JSON.parse(line)))
  const deployment = entries.findLast(entry => entry?.['type'] === 'deploy' && entry['worker_name'] === worker
    && (entry['wrangler_environment'] ?? '') === environment)
  if (!isVersionId(deployment?.['version_id'])) {
    throw new Error(`Wrangler did not report a valid deployed version for ${worker} in environment ${environment || 'default'}.`)
  }
  return deployment['version_id']
}
