/* eslint-disable test/no-import-node-test -- Docs coverage regression uses the installed repoctl bundle. */
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

interface NativeCoverage {
  checkReleaseCoverage: (
    source: string,
    record: { sourceSha: string, packages: Array<{ name: string, version: string, sourceSha: string }> },
    site: { packages: string[], releaseInputs: Record<string, string[]> },
  ) => Promise<{ blockers: string[], names: string[] }>
}

const packageName = '@fixture/docs-runtime'
const require = createRequire(import.meta.url)
const nativeRequire = createRequire(require.resolve('repoctl'))
const nativeEntry = nativeRequire.resolve('@icebreakers/monorepo')

async function loadNativeCoverage(): Promise<NativeCoverage> {
  const directory = path.dirname(nativeEntry)
  const commands = (await readdir(directory)).filter(name => /^commands-.*\.mjs$/u.test(name))
  assert.equal(commands.length, 1, 'Update this regression harness when repoctl changes its command bundle')
  const url = pathToFileURL(path.join(directory, commands[0]!))
  url.search = 'docs-coverage-regression'
  const hooks = registerHooks({
    load(target, context, nextLoad) {
      const loaded = nextLoad(target, context)
      if (target !== url.href) {
        return loaded
      }
      assert.ok(loaded.source)
      const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source as Uint8Array).toString('utf8')
      return { ...loaded, source: `${source}\nexport { checkReleaseCoverage };\n` }
    },
  })
  try {
    return await import(url.href) as NativeCoverage
  }
  finally {
    hooks.deregister()
  }
}

const native = loadNativeCoverage()

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', [
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=',
    ...args,
  ], { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

async function write(cwd: string, filename: string, content: string) {
  const target = path.join(cwd, filename)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content)
}

function commit(cwd: string, message: string) {
  git(cwd, 'add', '--all')
  git(cwd, '-c', 'user.name=Docs coverage test', '-c', 'user.email=docs-coverage@example.test', 'commit', '--quiet', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

async function fixture(t: TestContext, before: Record<string, unknown>, after: Record<string, unknown>, sourceChanged = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-docs-coverage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  git(root, 'init', '--quiet', '--initial-branch=main')
  await write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  await write(root, 'packages/runtime/package.json', `${JSON.stringify(before, null, 2)}\n`)
  await write(root, 'packages/runtime/index.js', 'export const value = 1\n')
  const publishedSha = commit(root, 'feat: publish docs runtime')
  await write(root, 'packages/runtime/package.json', `${JSON.stringify(after, null, 2)}\n`)
  if (sourceChanged) {
    await write(root, 'packages/runtime/index.js', 'export const value = 2\n')
  }
  const sourceSha = commit(root, 'chore: update docs runtime inputs')
  return { root: await realpath(root), publishedSha, sourceSha }
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    name: packageName,
    version: '1.0.0',
    exports: { '.': './index.js' },
    dependencies: { 'example-runtime': '^1.0.0' },
    ...overrides,
  }
}

async function planCoverage(t: TestContext, before: Record<string, unknown>, after: Record<string, unknown>, sourceChanged = false) {
  const { root, publishedSha, sourceSha } = await fixture(t, before, after, sourceChanged)
  return (await native).checkReleaseCoverage(root, {
    sourceSha,
    packages: [{ name: packageName, version: '1.0.0', sourceSha: publishedSha }],
  }, {
    packages: [packageName],
    releaseInputs: { [packageName]: ['packages/runtime/**'] },
  })
}

test('devDependencies-only manifest changes do not block stable documentation', async (t) => {
  const before = manifest({ devDependencies: { 'fake-indexeddb': '^6.2.5' } })
  const after = manifest({ devDependencies: { 'fake-indexeddb': '^6.2.8' } })
  const { root, publishedSha, sourceSha } = await fixture(t, before, after)
  const coverage = await native
  const result = await coverage.checkReleaseCoverage(root, {
    sourceSha,
    packages: [{ name: packageName, version: '1.0.0', sourceSha: publishedSha }],
  }, {
    packages: [packageName],
    releaseInputs: { [packageName]: ['packages/runtime/**'] },
  })
  assert.deepEqual(result.blockers, [])
})

test('public manifest changes remain unpublished inputs alongside dev dependency changes', async (t) => {
  const cases = [
    ['exports', { '.': './index.js', './runtime': './runtime.js' }],
    ['dependencies', { 'example-runtime': '^2.0.0' }],
  ] as const
  for (const [field, value] of cases) {
    await t.test(field, async (subtest) => {
      const before = manifest({ devDependencies: { 'fake-indexeddb': '^6.2.5' } })
      const after = manifest({ [field]: value, devDependencies: { 'fake-indexeddb': '^6.2.8' } })
      const result = await planCoverage(subtest, before, after)
      assert.ok(result.blockers.some(blocker => blocker.includes(`Unpublished inputs for ${packageName}: packages/runtime/package.json`)))
    })
  }
})

test('unpublished package source changes remain blocked', async (t) => {
  const result = await planCoverage(t, manifest(), manifest({ devDependencies: { 'fake-indexeddb': '^6.2.8' } }), true)
  assert.ok(result.blockers.some(blocker => blocker.includes(`Unpublished inputs for ${packageName}: packages/runtime/index.js`)))
})
