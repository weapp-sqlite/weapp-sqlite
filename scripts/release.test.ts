/* eslint-disable test/no-import-node-test -- Release CI checks run independently of workspace builds and Vitest projects. */
import type { TestContext } from 'node:test'
import type { GitHubOperations, ReleaseCiOptions } from 'repoctl'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { createReleasePullRequest, getWorkspaceData, logger, releaseCi } from 'repoctl'

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

async function preparePrivateWorkspace(t: TestContext, mixedIntent: boolean) {
  const { cwd } = await fixture(t)
  const privateLibrary = '@release-fixture/private-library'
  const privateApp = '@release-fixture/private-app'
  const manifests = [
    { directory: 'library', name: privateLibrary, dependency: packageName },
    { directory: 'app', name: privateApp, dependency: privateLibrary },
  ]
  for (const { directory, name, dependency } of manifests) {
    await write(cwd, `packages/${directory}/package.json`, `${JSON.stringify({
      name,
      version: '0.1.0',
      private: true,
      // Match this repository's public package -> demo-shared -> example graph.
      dependencies: { [dependency]: 'workspace:*' },
    }, null, 2)}\n`)
  }
  await write(cwd, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\nversioning:\n  changelog:\n    storage: repository\n')
  await write(cwd, '.gitignore', '.pnpm-store/\n')
  await write(cwd, '.changeset/upgrade-runtime.md', `---\n"${packageName}": minor\n${mixedIntent ? `"${privateLibrary}": minor\n` : ''}---\n\n升级运行时并验证私有工作区的依赖传播。\n`)

  // A separate worker can answer registry requests while repoctl synchronously
  // invokes pnpm. Registry metadata and cache are isolated from the real npm registry.
  const registry = new Worker(`
    const { createServer } = require('node:http')
    const { parentPort, workerData } = require('node:worker_threads')
    createServer((request, response) => {
      const name = decodeURIComponent(request.url.slice(1))
      response.setHeader('content-type', 'application/json')
      if (request.method !== 'GET') {
        response.writeHead(405)
        response.end(JSON.stringify({ error: 'Only registry metadata reads are allowed' }))
        return
      }
      if (!workerData.includes(name)) {
        response.writeHead(404)
        response.end(JSON.stringify({ error: 'Not found' }))
        return
      }
      response.end(JSON.stringify({
        name,
        'dist-tags': { latest: '0.1.0' },
        versions: { '0.1.0': { name, version: '0.1.0' } },
      }))
    }).listen(0, '127.0.0.1', function () {
      parentPort.postMessage(this.address().port)
    })
  `, { eval: true, workerData: [packageName, privateLibrary, privateApp] })
  t.after(() => registry.terminate())
  const [port] = await once(registry, 'message')
  const registryUrl = `http://127.0.0.1:${port}/`
  await write(cwd, '.npmrc', `registry=${registryUrl}\n@release-fixture:registry=${registryUrl}\nstore-dir=.pnpm-store\n`)
  commit(cwd, 'feat: prepare runtime change with private workspace consumers')

  // pnpm supplies its actual launcher to scripts. Native executables work on
  // every CI OS; JavaScript launchers need Node rather than a Windows .cmd shim.
  const pnpm = process.env['npm_execpath']
  assert.ok(pnpm, 'Run release regressions with pnpm test:release')
  const pnpmCommand = /\.[cm]?js$/i.test(pnpm) ? process.execPath : pnpm
  const pnpmPrefix = pnpmCommand === process.execPath ? [pnpm] : []
  const pnpmVersion = spawnSync(pnpmCommand, [...pnpmPrefix, '--version'], { cwd, encoding: 'utf8' })
  assert.equal(pnpmVersion.status, 0, pnpmVersion.stderr)
  const rootManifest = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'))
  assert.equal(`pnpm@${pnpmVersion.stdout.trim()}`, rootManifest.packageManager.split('+')[0])

  const pullRequests: Array<Parameters<GitHubOperations['ensurePullRequest']>[0]> = []
  const pushes: string[][] = []
  const versionCommands: string[][] = []
  const forbidPublish = async () => assert.fail('Release preparation must not publish packages or GitHub releases')
  const github: GitHubOperations = {
    ensurePullRequest: async (options) => {
      pullRequests.push(options)
      return { number: 1, html_url: 'https://example.invalid/pull/1', state: 'open' }
    },
    ensureRelease: forbidPublish,
    ensureTag: forbidPublish,
    writeReleaseState: forbidPublish,
    readReleaseState: async () => undefined,
    readTagTarget: async () => undefined,
    listReleases: async () => [],
  }
  const spawn: NonNullable<ReleaseCiOptions['spawn']> = ((command: string, args: string[], options: Parameters<typeof spawnSync>[2]) => {
    if (command === 'git' && args[0] === 'push') {
      pushes.push(args)
      return { status: 0, stdout: '', stderr: '' }
    }
    if (command === 'pnpm') {
      assert.deepEqual(args, ['version', '-r', '--no-git-checks', '--json'])
      versionCommands.push(args)
      const result = spawnSync(pnpmCommand, [...pnpmPrefix, ...args], { ...options, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 })
      assert.equal(result.status, 0, `pnpm version failed: ${result.error?.message ?? ''}\n${result.stderr}\n${result.stdout}`)
      return result
    }
    assert.equal(command, 'git', `Unexpected preparation command: ${command} ${args.join(' ')}`)
    assert.ok(new Set(['rev-parse', 'log', 'show', 'cat-file', 'ls-tree', 'rev-list', 'diff', 'status', 'config', 'checkout', 'add', 'commit']).has(args[0] ?? ''))
    const result = spawnSync(command, ['-c', `core.hooksPath=${path.join(cwd, '.git', 'no-hooks')}`, '-c', 'commit.gpgsign=false', ...args], { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    assert.ok(result.status === 0 || args[0] === 'diff', `git ${args.join(' ')}: ${result.stderr}`)
    return result
  }) as NonNullable<ReleaseCiOptions['spawn']>
  assert.equal(await createReleasePullRequest({
    cwd,
    branch: 'main',
    config: { qualityScripts: [] },
    github,
    spawn,
    env: { ...process.env, npm_config_registry: registryUrl, GITHUB_REPOSITORY: 'release-fixture/repository' },
  }), true)
  assert.equal(versionCommands.length, 1, 'Preparation must run the real workspace version solver')
  assert.equal(pushes.length, 1)
  assert.equal(pullRequests.length, 1, 'The release-note guard must permit creation of the release PR')
  assert.match(pullRequests[0]!.body, /@release-fixture\/runtime/)
  assert.ok(!pullRequests[0]!.body.includes(privateLibrary))
  assert.ok(!pullRequests[0]!.body.includes(privateApp))
  const { packages } = await getWorkspaceData(cwd, { ignorePrivatePackage: false })
  const versions = new Map(packages.map(pkg => [pkg.manifest.name, pkg.manifest.version]))
  assert.equal(versions.get(packageName), '0.2.0')
  assert.equal(versions.get(privateLibrary), mixedIntent ? '0.2.0' : '0.1.1')
  assert.equal(versions.get(privateApp), '0.1.1')
  for (const { directory, dependency } of manifests) {
    const manifest = JSON.parse(await readFile(path.join(cwd, `packages/${directory}/package.json`), 'utf8'))
    assert.equal(manifest.dependencies?.[dependency], 'workspace:*')
  }
  const prepared = git(cwd, 'rev-parse', 'HEAD')
  assert.deepEqual(await dryRun(t, cwd), [{ name: packageName, version: '0.2.0', target: prepared }])
}

test('real pnpm propagates a public release through multiple private workspaces', async (t) => {
  await preparePrivateWorkspace(t, false)
})

test('real pnpm prepares mixed public and private changesets without publishing private packages', async (t) => {
  await preparePrivateWorkspace(t, true)
})

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
  // Reproduce the actual tooling migration on top of the historical release.
  // Its original ledger, manifests and release notes must keep their source SHA.
  git(cwd, 'config', 'user.name', 'Release regression')
  git(cwd, 'config', 'user.email', 'release-regression@example.invalid')
  const config = await readFile(path.join(cwd, 'repoctl.config.ts'), 'utf8')
  assert.ok(config.includes('monorepoCommand:'))
  await write(cwd, 'repoctl.config.ts', config.replace('monorepoCommand:', 'repoCommand:'))
  commit(cwd, 'chore(deps): migrate repoctl config after the historical release')
  const { packages } = await getWorkspaceData(cwd)
  assert.equal(packages.length, 9)
  const targets = await dryRun(t, cwd)
  assert.deepEqual(
    targets.map(({ name, version }) => ({ name, version })).sort((a, b) => a.name.localeCompare(b.name)),
    packages.map(({ manifest }) => ({ name: manifest.name, version: manifest.version })).sort((a, b) => a.name!.localeCompare(b.name!)),
  )
  assert.deepEqual(new Set(targets.map(pkg => pkg.target)), new Set([prepared]))
})
