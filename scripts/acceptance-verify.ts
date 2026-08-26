import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { acceptanceArtifactRoot, assertCleanRepository } from './acceptance-paths'

interface AcceptanceReport {
  readonly schemaVersion: number
  readonly commit: string
  readonly target: string
  readonly passed: boolean
  readonly screenshots?: { readonly first?: string, readonly persisted?: string }
  readonly checks?: Record<string, unknown>
  readonly device?: Record<string, unknown>
}

interface PageAcceptance {
  readonly passed?: boolean
  readonly checks?: readonly { readonly passed?: boolean }[]
  readonly environment?: Record<string, unknown>
}

const mobileCheckNames = [
  'reset',
  'firstRun',
  'migration',
  'parameterBinding',
  'transactionCommit',
  'transactionRollback',
  'processRelaunch',
  'persistence',
] as const

function requireAutomatedChecks(report: AcceptanceReport, relativePath: string) {
  const first = report.checks?.['first'] as PageAcceptance | undefined
  const persisted = report.checks?.['persisted'] as PageAcceptance | undefined
  for (const [phase, value] of [['first', first], ['persisted', persisted]] as const) {
    if (value?.passed !== true || !Array.isArray(value.checks) || !value.checks.every(check => check.passed === true)) {
      throw new Error(`Automated acceptance phase is incomplete: ${relativePath}#${phase}`)
    }
    const expectedTarget = report.target === 'web' ? 'web' : 'weapp'
    if (value.environment?.['target'] !== expectedTarget) {
      throw new Error(`Automated acceptance platform is invalid: ${relativePath}#${phase}`)
    }
  }
  if (report.target === 'web') {
    if (typeof first?.environment?.['userAgent'] !== 'string' || !first.environment['userAgent'].trim()) {
      throw new Error(`Web acceptance user agent is missing: ${relativePath}`)
    }
    for (const field of ['consoleErrors', 'runtimeErrors'] as const) {
      const errors = report.checks?.[field]
      if (!Array.isArray(errors) || errors.length > 0) {
        throw new Error(`Web acceptance contains ${field}: ${relativePath}`)
      }
    }
  }
  else {
    for (const field of ['system', 'clientVersion', 'sdkVersion'] as const) {
      if (typeof first?.environment?.[field] !== 'string' || !first.environment[field].trim()) {
        throw new Error(`DevTools environment field is missing: ${relativePath}#first.environment.${field}`)
      }
    }
  }
}

function requireMobileChecks(report: AcceptanceReport, relativePath: string) {
  for (const field of ['model', 'osVersion', 'wechatVersion', 'sdkVersion'] as const) {
    if (typeof report.device?.[field] !== 'string' || !report.device[field].trim()) {
      throw new Error(`Mobile acceptance device field is missing: ${relativePath}#device.${field}`)
    }
  }
  for (const check of mobileCheckNames) {
    if (report.checks?.[check] !== true) {
      throw new Error(`Mobile acceptance check failed: ${relativePath}#checks.${check}`)
    }
  }
}

function resolveEvidencePath(reportPath: string, relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Acceptance screenshot path must be relative: ${relativePath}`)
  }
  const directory = path.dirname(reportPath)
  const resolved = path.resolve(directory, relativePath)
  const relation = path.relative(directory, resolved)
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error(`Acceptance screenshot leaves its evidence directory: ${relativePath}`)
  }
  return resolved
}

await assertCleanRepository()
const { commit, root } = await acceptanceArtifactRoot()
const reportTargets = new Map([
  ['web/report.json', 'web'],
  ['devtools/report.json', 'devtools'],
  ['mobile/ios-min.json', 'ios-min'],
  ['mobile/ios-latest.json', 'ios-latest'],
  ['mobile/android-min.json', 'android-min'],
  ['mobile/android-latest.json', 'android-latest'],
])

for (const [relativePath, target] of reportTargets) {
  const reportPath = path.join(root, relativePath)
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as AcceptanceReport
  if (report.schemaVersion !== 1 || report.commit !== commit || report.target !== target || report.passed !== true || !report.checks) {
    throw new Error(`Acceptance report is incomplete or failed: ${relativePath}`)
  }
  if (target === 'web' || target === 'devtools') {
    requireAutomatedChecks(report, relativePath)
  }
  else {
    requireMobileChecks(report, relativePath)
  }
  if (!report.screenshots?.first || !report.screenshots.persisted) {
    throw new Error(`Acceptance screenshots are missing: ${relativePath}`)
  }
  await access(resolveEvidencePath(reportPath, report.screenshots.first))
  await access(resolveEvidencePath(reportPath, report.screenshots.persisted))
}

console.log(JSON.stringify({ commit, passed: true, reports: [...reportTargets.keys()] }))
