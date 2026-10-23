import path from 'node:path'

export const docsTargets = {
  preview: { url: 'https://preview.sqlite.weapp.dev', worker: 'weapp-sqlite-docs-preview', environment: 'preview' },
  stable: { url: 'https://sqlite.weapp.dev', worker: 'weapp-sqlite-docs', environment: '' },
} as const

export type DocsChannel = keyof typeof docsTargets

export interface BuildIdentity {
  schemaVersion: 1
  site: 'website'
  channel: DocsChannel
  sourceSha: string
  releaseId: string
  deploymentId: string
  url: string
  workerName: string
}

export function resolveChannel(value = 'preview'): DocsChannel {
  if (value !== 'preview' && value !== 'stable') {
    throw new Error(`Unknown documentation channel: ${value}`)
  }
  return value
}

export function assertDeploymentContext(env: NodeJS.ProcessEnv, channel: DocsChannel) {
  if (env['REPO_DOCS_SITE'] !== 'website' || env['REPO_DOCS_CHANNEL'] !== channel
    || !/^[a-f\d]{40}$/u.test(env['REPO_DOCS_SOURCE_SHA'] ?? '')
    || !/^[a-f\d]{64}$/u.test(env['REPO_DOCS_DEPLOYMENT_ID'] ?? '')
    || !env['REPO_DOCS_RESULT_FILE'] || !path.isAbsolute(env['REPO_DOCS_RESULT_FILE'])
    || env['REPO_DOCS_URL'] !== docsTargets[channel].url) {
    throw new Error('Direct website deployment is disabled. Use repo docs deploy website with a verified source and channel.')
  }
  if (channel === 'stable' && (!env['REPO_DOCS_RELEASE_ID']?.trim() || env['GITHUB_ACTIONS'] !== 'true'
    || !env['GITHUB_RUN_ID'] || env['REPO_DOCS_CONCURRENCY_GROUP'] !== 'docs-website-stable')) {
    throw new Error('Stable documentation requires a completed release and the managed docs-website-stable workflow.')
  }
  if (channel === 'preview' && env['REPO_DOCS_RELEASE_ID']) {
    throw new Error('Preview documentation cannot use a stable release identity.')
  }
}

export function buildIdentity(env: NodeJS.ProcessEnv, fallbackSha = ''): BuildIdentity {
  const channel = resolveChannel(env['REPO_DOCS_CHANNEL'])
  const target = docsTargets[channel]
  const managed = ['REPO_DOCS_SITE', 'REPO_DOCS_SOURCE_SHA', 'REPO_DOCS_RELEASE_ID', 'REPO_DOCS_DEPLOYMENT_ID', 'REPO_DOCS_RESULT_FILE']
    .some(key => Boolean(env[key]))
  if (channel === 'stable' || managed) {
    assertDeploymentContext(env, channel)
  }
  if (env['REPO_DOCS_URL'] && env['REPO_DOCS_URL'] !== target.url) {
    throw new Error('Documentation URL does not match its channel.')
  }
  const sourceSha = env['REPO_DOCS_SOURCE_SHA'] || fallbackSha
  if (!/^[a-f\d]{40}$/u.test(sourceSha)) {
    throw new Error('Documentation builds require a complete source commit SHA.')
  }
  if (fallbackSha && fallbackSha !== sourceSha) {
    throw new Error('The documentation checkout does not match the selected source commit.')
  }
  return {
    schemaVersion: 1,
    site: 'website',
    channel,
    sourceSha,
    releaseId: env['REPO_DOCS_RELEASE_ID'] || '',
    deploymentId: env['REPO_DOCS_DEPLOYMENT_ID'] || '',
    url: target.url,
    workerName: target.worker,
  }
}

export function assertBuildIdentity(actual: unknown, expected: BuildIdentity) {
  if (!actual || typeof actual !== 'object'
    || Object.entries(expected).some(([key, value]) => (actual as Record<string, unknown>)[key] !== value)) {
    throw new Error('Documentation artifact does not match this deployment; rebuild the selected snapshot.')
  }
}

export function deploymentMessage(identity: BuildIdentity) {
  return `repoctl-docs:${identity.deploymentId}`
}

export function docsHeaders(channel: DocsChannel) {
  return channel === 'preview'
    ? '/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n'
    : '# Stable documentation is indexable.\n'
}
