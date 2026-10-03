/* eslint-disable test/no-import-node-test -- Release CI checks run independently of workspace builds and Vitest projects. */
import type { TestContext } from 'node:test'
import type { GitHubOperations, ReleaseCiOptions } from 'repoctl'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getWorkspaceData, logger, releaseCi } from 'repoctl'

const repository = fileURLToPath(new URL('..', import.meta.url))
const packageName = '@release-fixture/runtime'
const manifestPath = 'packages/runtime/package.json'
const changelogPath = 'packages/runtime/CHANGELOG.md'
const ledgerPath = '.changeset/ledger.yaml'

interface ReleaseTarget {
  name: string
  version: string
  target: string
}

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', [
    '-c',
    `core.hooksPath=${path.join(cwd, '.git', 'no-hooks')}`,
    '-c',
    'commit.gpgsign=false',
    '-c',
    'tag.gpgsign=false',
    ...args,
  ], { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

async function temporaryDirectory(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-release-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function write(cwd: string, filename: string, content: string) {
  const target = path.join(cwd, filename)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content)
}

function commit(cwd: string, message: string) {
  git(cwd, 'add', '--all')
  git(cwd, 'commit', '--quiet', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

async function writeManifest(cwd: string, version = '0.1.0', extra = {}) {
  await write(cwd, manifestPath, `${JSON.stringify({ name: packageName, version, ...extra }, null, 2)}\n`)
}

async function fixture(t: TestContext) {
  const cwd = await temporaryDirectory(t)
  git(cwd, 'init', '--quiet', '--initial-branch=main')
  git(cwd, 'config', 'user.name', 'Release regression')
  git(cwd, 'config', 'user.email', 'release-regression@example.invalid')
  await write(cwd, 'package.json', JSON.stringify({ name: 'release-fixture', private: true }))
  await write(cwd, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  await writeManifest(cwd)
  const initial = commit(cwd, 'feat: create package before its first release')
  return { cwd, initial }
}

async function prepareFirstRelease(cwd: string) {
  await write(cwd, ledgerPath, `"${packageName}@0.1.0":\n  dir: packages/runtime\n  intents:\n    - first-release\n`)
  await write(cwd, changelogPath, '# Runtime\n\n## 0.1.0\n\n### Minor Changes\n\n- First release.\n')
  return commit(cwd, 'chore(release): prepare first release without changing its initial version')
}

async function dryRun(t: TestContext, cwd: string) {
  const plans: Array<{ packages: ReleaseTarget[] }> = []
  const log = t.mock.method(logger, 'info', (message: unknown) => {
    if (typeof message === 'string' && message.startsWith('{')) {
      plans.push(JSON.parse(message) as { packages: ReleaseTarget[] })
    }
  })
  const forbidWrite = async () => {
    assert.fail('A release dry run must never write to GitHub')
  }
  const github: GitHubOperations = {
    ensurePullRequest: forbidWrite,
    ensureRelease: forbidWrite,
    ensureTag: forbidWrite,
    writeReleaseState: forbidWrite,
    readReleaseState: async () => undefined,
    readTagTarget: async () => undefined,
    listReleases: async () => [],
  }
  const readOnlyGitCommands = new Set(['rev-parse', 'log', 'show', 'cat-file', 'ls-tree', 'rev-list', 'diff', 'status'])
  const spawn: NonNullable<ReleaseCiOptions['spawn']> = ((command: string, args: string[], options: Parameters<typeof spawnSync>[2]) => {
    if (command === 'npm' && args[0] === 'view') {
      return { status: 1, stdout: '', stderr: 'E404 Not Found' }
    }
    assert.equal(command, 'git', `Unexpected release command: ${command} ${args.join(' ')}`)
    assert.ok(readOnlyGitCommands.has(args[0] ?? ''), `Release dry run attempted Git mutation: ${args.join(' ')}`)
    return spawnSync(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  }) as NonNullable<ReleaseCiOptions['spawn']>

  try {
    const result = await releaseCi({
      cwd,
      branch: 'main',
      mode: 'publish',
      dryRun: true,
      github,
      spawn,
      env: { GITHUB_REPOSITORY: 'release-fixture/repository' },
    })
    assert.equal(plans.length, 1, 'Expected one release plan from the public dry-run entry point')
    const plan = plans[0]!
    assert.deepEqual(result, plan.packages.map(({ name, version }) => ({ name, version })))
    assert.equal(git(cwd, 'status', '--porcelain'), '', 'Dry run must leave the checkout unchanged')
    return plan.packages
  }
  finally {
    log.mock.restore()
  }
}

test('first release uses its ledger preparation commit when the package version did not change', async (t) => {
  const { cwd, initial } = await fixture(t)
  const prepared = await prepareFirstRelease(cwd)
  assert.notEqual(prepared, initial)
  assert.deepEqual(await dryRun(t, cwd), [{ name: packageName, version: '0.1.0', target: prepared }])
})

test('later unrelated ledger entries and manifest edits do not replace the release source', async (t) => {
  const { cwd } = await fixture(t)
  const prepared = await prepareFirstRelease(cwd)
  const ledger = await readFile(path.join(cwd, ledgerPath), 'utf8')
  await write(cwd, ledgerPath, `${ledger}"unrelated-package@2.0.0":\n  dir: packages/unrelated\n  intents:\n    - unrelated-release\n`)
  await writeManifest(cwd, '0.1.0', { description: 'Updated after release preparation' })
  commit(cwd, 'chore: unrelated release and package metadata')
  assert.deepEqual(await dryRun(t, cwd), [{ name: packageName, version: '0.1.0', target: prepared }])
})

test('an uncommitted ledger entry cannot establish a prepared release commit', async (t) => {
  const { cwd } = await fixture(t)
  await write(cwd, ledgerPath, `"${packageName}@0.1.0":\n  dir: packages/runtime\n  intents:\n    - first-release\n`)
  await write(cwd, changelogPath, '# Runtime\n\n## 0.1.0\n\n- Uncommitted release notes.\n')
  await assert.rejects(dryRun(t, cwd), /Cannot find prepared release commit/)
})

test('a release merged without squashing belongs to its first-parent merge commit', async (t) => {
  const { cwd } = await fixture(t)
  git(cwd, 'checkout', '--quiet', '-b', 'release/prepared')
  const prepared = await prepareFirstRelease(cwd)
  git(cwd, 'checkout', '--quiet', 'main')
  await write(cwd, 'README.md', '# Main branch change\n')
  commit(cwd, 'docs: update main while release is prepared')
  git(cwd, 'merge', '--quiet', '--no-ff', '-m', 'chore(release): merge prepared release', 'release/prepared')
  const merged = git(cwd, 'rev-parse', 'HEAD')
  assert.notEqual(merged, prepared)
  assert.deepEqual(await dryRun(t, cwd), [{ name: packageName, version: '0.1.0', target: merged }])
})

test('dependency-propagated versions without a ledger entry retain the version commit fallback', async (t) => {
  const { cwd } = await fixture(t)
  await writeManifest(cwd, '0.1.1', { dependencies: { '@release-fixture/dependency': '^1.0.1' } })
  await write(cwd, changelogPath, '# Runtime\n\n## 0.1.1\n\n### Patch Changes\n\n- Updated dependencies.\n')
  const prepared = commit(cwd, 'chore(release): propagate dependency version')
  await writeManifest(cwd, '0.1.1', { description: 'Later metadata', dependencies: { '@release-fixture/dependency': '^1.0.1' } })
  commit(cwd, 'chore: later package metadata')
  assert.deepEqual(await dryRun(t, cwd), [{ name: packageName, version: '0.1.1', target: prepared }])
})

test('a version commit without release notes cannot borrow a changelog added later', async (t) => {
  const { cwd } = await fixture(t)
  await write(cwd, changelogPath, '# Runtime\n\n## 0.1.0\n\n- Notes added without release preparation.\n')
  commit(cwd, 'docs: add notes after the version was introduced')
  await assert.rejects(dryRun(t, cwd), /Changelog differs/)
})

test('release recovery rejects a changed changelog', async (t) => {
  const { cwd } = await fixture(t)
  await prepareFirstRelease(cwd)
  await write(cwd, changelogPath, '# Runtime\n\n## 0.1.0\n\n- Rewritten after preparation.\n')
  commit(cwd, 'docs: change prepared release notes')
  await assert.rejects(dryRun(t, cwd), /[Cc]hangelog/)
})

test('release recovery rejects deleting the prepared changelog', async (t) => {
  const { cwd } = await fixture(t)
  await prepareFirstRelease(cwd)
  await rm(path.join(cwd, changelogPath))
  commit(cwd, 'docs: delete prepared release notes')
  await assert.rejects(dryRun(t, cwd), /[Cc]hangelog/)
})

test('release source discovery rejects a shallow checkout', async (t) => {
  const { cwd } = await fixture(t)
  await prepareFirstRelease(cwd)
  const shallow = await temporaryDirectory(t)
  git(cwd, 'clone', '--quiet', '--depth=1', '--no-tags', pathToFileURL(cwd).href, shallow)
  assert.equal(git(shallow, 'rev-parse', '--is-shallow-repository'), 'true')
  await assert.rejects(dryRun(t, shallow), /full checkout/)
})

test('the actual first DevTools release resolves all nine packages to the prepared release commit', async (t) => {
  // Preserve the failing release as a regression fixture without pinning package
  // versions or copying the release resolver into the test's expectations.
  const prepared = git(repository, 'log', '--format=%H', '--diff-filter=A', '--', 'packages/devtools/CHANGELOG.md').split('\n').at(-1)
  assert.match(prepared ?? '', /^[a-f0-9]{40}$/, 'Full history is required for the release regression')
  const cwd = await temporaryDirectory(t)
  git(repository, 'clone', '--quiet', '--no-hardlinks', '--no-checkout', '--no-tags', repository, cwd)
  git(cwd, 'checkout', '--quiet', '--detach', prepared!)
  const { packages } = await getWorkspaceData(cwd)
  assert.equal(packages.length, 9)
  const targets = await dryRun(t, cwd)
  assert.deepEqual(
    targets.map(({ name, version }) => ({ name, version })).sort((a, b) => a.name.localeCompare(b.name)),
    packages.map(({ manifest }) => ({ name: manifest.name, version: manifest.version })).sort((a, b) => a.name!.localeCompare(b.name!)),
  )
  assert.deepEqual(new Set(targets.map(pkg => pkg.target)), new Set([prepared]))
})
