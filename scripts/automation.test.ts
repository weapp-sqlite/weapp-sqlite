/* eslint-disable test/no-import-node-test -- Automation contracts run independently of workspace builds. */
/* eslint-disable no-template-curly-in-string -- Workflow assertions contain literal GitHub Actions expressions. */
import type { TestContext } from 'node:test'
import type { NightlyOptions, SnapshotReport } from 'repoctl'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkPackages, createNightlyPlan, createSnapshotPlan, getWorkspaceData, releaseNightly } from 'repoctl'
import { parse } from 'yaml'
import config from '../repoctl.config'

const repository = fileURLToPath(new URL('..', import.meta.url))
const releaseConfig = config.commands.release
const site = config.commands.docs.sites.website
const require = createRequire(import.meta.url)

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', ['-c', `core.hooksPath=${path.join(cwd, '.git/no-hooks')}`, '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

async function temporaryRepository(t: TestContext) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-automation-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const cwd = path.join(directory, 'source')
  await mkdir(cwd)
  git(cwd, 'init', '--quiet', '--initial-branch=main')
  git(cwd, 'config', 'user.name', 'Automation regression')
  git(cwd, 'config', 'user.email', 'automation@example.invalid')
  return { directory, cwd }
}

async function write(cwd: string, filename: string, content: string) {
  const destination = path.join(cwd, filename)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, content)
}

async function snapshotFixture(t: TestContext) {
  const { directory, cwd } = await temporaryRepository(t)
  const { packages } = await getWorkspaceData(repository, { ignorePrivatePackage: false, ignoreRootPackage: false })
  for (const filename of ['package.json', 'pnpm-workspace.yaml']) {
    await copyFile(path.join(repository, filename), path.join(cwd, filename))
  }
  for (const pkg of packages) {
    if (pkg.rootDir === repository) {
      continue
    }
    await write(cwd, path.join(path.relative(repository, pkg.rootDir), 'package.json'), JSON.stringify(pkg.manifest))
  }
  // No intents are pending in this fixture; a registry request is a regression.
  await write(cwd, '.npmrc', 'registry=http://127.0.0.1:9/\n')
  git(cwd, 'add', '--all')
  git(cwd, 'commit', '--quiet', '-m', 'test: freeze the actual workspace package graph')
  const commit = git(cwd, 'rev-parse', 'HEAD')
  const pnpm = process.env['npm_execpath']
  assert.ok(pnpm, 'Run automation regressions with pnpm test:automation')
  const pnpmCommand = /\.[cm]?js$/iu.test(pnpm) ? process.execPath : pnpm
  const pnpmPrefix = pnpmCommand === process.execPath ? [pnpm] : []
  const spawn: NonNullable<NightlyOptions['spawn']> = ((command: string, args: string[], options: Parameters<typeof spawnSync>[2]) => {
    if (command === 'pnpm') {
      const operation = args.filter(arg => !arg.startsWith('--config.')).join(' ')
      assert.ok(operation === '--version' || operation === 'version --help'
        || operation === 'version -r --dry-run --json --no-git-checks', `Unexpected pnpm mutation: ${args.join(' ')}`)
      return spawnSync(pnpmCommand, [...pnpmPrefix, ...args], { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    }
    assert.equal(command, 'git')
    assert.ok(['rev-parse', '--no-optional-locks'].includes(args[0] ?? ''), `Unexpected Git mutation: ${args.join(' ')}`)
    return spawnSync(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  }) as NonNullable<NightlyOptions['spawn']>
  return { directory, cwd, commit, spawn, packages }
}

function registry(snapshot: SnapshotReport, missing?: string): typeof fetch {
  const byName = new Map(snapshot.packages.map(pkg => [pkg.name, pkg]))
  return async (input, options) => {
    assert.ok(!options?.method || options.method === 'GET', 'Nightly planning must never write to the registry')
    const url = new URL(String(input))
    assert.equal(url.origin, 'https://registry.npmjs.org')
    const tags = url.pathname.match(/^\/-\/package\/([^/]+)\/dist-tags$/u)
    const name = decodeURIComponent(tags?.[1] ?? url.pathname.split('/')[1]!)
    const pkg = byName.get(name)
    assert.ok(pkg, `Unexpected package registry lookup: ${name}`)
    if (tags) {
      return Response.json({ latest: pkg.currentVersion, ...(name === missing ? {} : { 'snapshot-nightly': pkg.version }) })
    }
    assert.equal(decodeURIComponent(url.pathname.split('/')[2]!), pkg.version)
    return Response.json({
      name,
      version: pkg.version,
      repoctlSnapshot: { ...snapshot.identity, identityKey: snapshot.identityKey, tag: snapshot.tag },
      dist: { integrity: `sha512-${'a'.repeat(86)}==` },
    })
  }
}

test('the nightly snapshot covers the nine public packages and their complete internal dependency graph', async (t) => {
  const { cwd, commit, spawn, packages } = await snapshotFixture(t)
  const before = git(cwd, 'status', '--porcelain')
  const snapshot = await createSnapshotPlan({ cwd, identity: { kind: 'nightly', commit, buildId: '101-1' }, spawn })
  assert.equal(snapshot.status, 'planned')
  assert.equal(snapshot.tag, 'snapshot-nightly')
  assert.equal(snapshot.packages.length, 9)
  assert.deepEqual(snapshot.packages.map(pkg => pkg.name).sort(), [...site.packages].sort())
  const names = new Set(snapshot.packages.map(pkg => pkg.name))
  const workspaceNames = new Set(packages.map(pkg => pkg.manifest.name))
  let dependencyEdges = 0
  for (const pkg of packages) {
    if (pkg.manifest.private) {
      assert.ok(!names.has(pkg.manifest.name!))
      continue
    }
    const planned = snapshot.packages.find(item => item.name === pkg.manifest.name)
    assert.ok(planned)
    assert.equal(planned.currentVersion, pkg.manifest.version)
    assert.ok(planned.version.endsWith(`-snapshot.nightly.c${commit}.b${snapshot.identityKey}`))
    for (const dependency of Object.keys({ ...pkg.manifest.dependencies, ...pkg.manifest.optionalDependencies, ...pkg.manifest.peerDependencies })) {
      if (workspaceNames.has(dependency)) {
        assert.ok(names.has(dependency), `${pkg.manifest.name} requires ${dependency} in the same snapshot batch`)
        dependencyEdges++
      }
    }
  }
  assert.ok(dependencyEdges > 0)
  assert.equal(git(cwd, 'status', '--porcelain'), before)
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), commit)
})

test('the configured schedule skips a complete existing batch but manual runs plan a fresh batch', async (t) => {
  const { cwd, directory, commit, spawn } = await snapshotFixture(t)
  const snapshot = await createSnapshotPlan({ cwd, identity: { kind: 'nightly', commit, buildId: '101-1' }, spawn })
  const eventFile = path.join(directory, 'event.json')
  const event = { repository: { full_name: 'weapp-sqlite/weapp-sqlite', default_branch: 'main' }, schedule: releaseConfig.nightly.schedule }
  await writeFile(eventFile, JSON.stringify(event))
  const env = {
    ...process.env,
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: event.repository.full_name,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: commit,
    GITHUB_RUN_ID: '102',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_EVENT_NAME: 'schedule',
    GITHUB_EVENT_PATH: eventFile,
    GITHUB_STEP_SUMMARY: '',
    REPOCTL_NIGHTLY_PROVIDER: releaseConfig.nightly.provider,
    REPOCTL_NIGHTLY_SCHEDULE: releaseConfig.nightly.schedule,
  }
  const options: NightlyOptions = { cwd, env, spawn, config: releaseConfig, outputDirectory: path.join(directory, 'reports'), registryFetch: registry(snapshot) }
  const scheduled = await createNightlyPlan(options)
  assert.equal(scheduled.status, 'skipped', scheduled.error ?? '')
  assert.equal(scheduled.packages.length, 9)
  assert.deepEqual(scheduled.latest, Object.fromEntries(snapshot.packages.map(pkg => [pkg.name, pkg.currentVersion])))
  assert.deepEqual(scheduled.commands, [])

  const partial = await createNightlyPlan({ ...options, registryFetch: registry(snapshot, snapshot.packages[0]!.name) })
  assert.equal(partial.status, 'planned', partial.error ?? '')

  await writeFile(eventFile, JSON.stringify({ repository: event.repository, inputs: { mode: 'nightly' } }))
  const manual = await releaseNightly({ ...options, dryRun: true, env: { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ID: '103' } })
  assert.equal(manual.status, 'planned', manual.error ?? '')
  assert.equal(manual.buildId, '103-1')
  assert.notEqual(manual.snapshot?.identityKey, snapshot.identityKey)
  assert.deepEqual(manual.latest, scheduled.latest)
  assert.deepEqual(manual.commands, [])

  await writeFile(eventFile, JSON.stringify(event))
  assert.ok(manual.snapshot)
  const priorBatch = registry(snapshot)
  const newBatch = registry(manual.snapshot)
  const mixed = await createNightlyPlan({
    ...options,
    registryFetch: (input, init) => new URL(String(input)).pathname.split('/').map(decodeURIComponent).includes(snapshot.packages[0]!.name)
      ? newBatch(input, init)
      : priorBatch(input, init),
  })
  assert.equal(mixed.status, 'planned', mixed.error ?? '')
  assert.equal(git(cwd, 'status', '--porcelain'), '')
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), commit)
})

test('managed workflows route main to preview and only completed stable releases to production', async () => {
  const release = parse(await readFile(path.join(repository, '.github/workflows/release.yml'), 'utf8'))
  const docs = parse(await readFile(path.join(repository, '.github/workflows/repoctl-docs.yml'), 'utf8'))
  const deploy = parse(await readFile(path.join(repository, '.github/workflows/repoctl-docs-deploy.yml'), 'utf8'))
  assert.deepEqual(release.on.schedule, [{ cron: releaseConfig.nightly.schedule }])
  assert.ok(release.on.workflow_dispatch.inputs.mode.options.includes('nightly'))
  assert.equal(release.jobs.nightly.env.REPOCTL_NIGHTLY_PROVIDER, releaseConfig.nightly.provider)
  assert.equal(release.jobs.nightly.env.REPOCTL_NIGHTLY_SCHEDULE, releaseConfig.nightly.schedule)
  assert.deepEqual(release.jobs.nightly.permissions, { 'contents': 'read', 'id-token': 'write' })
  assert.match(release.jobs.nightly.if, /github\.event_name == 'schedule'/u)
  assert.match(release.jobs.nightly.if, /inputs\.mode == 'nightly'/u)
  const stages = release.jobs.release.steps.filter((step: { id?: string }) => /^release-(?:plan|verify|prepare|upload|confirm|finalize)$/u.test(step.id ?? ''))
  assert.deepEqual(stages.map((step: { id: string }) => step.id), ['release-plan', 'release-verify', 'release-prepare', 'release-upload', 'release-confirm', 'release-finalize'])
  assert.equal(release.jobs.release.outputs['release-record'], '${{ steps.release-finalize.outputs.release-record }}')
  assert.equal(release.jobs.docs.needs, 'release')
  assert.equal(release.jobs.docs.with.channel, 'stable')
  assert.equal(release.jobs.docs.with.release, '${{ needs.release.outputs.release-record }}')
  assert.match(release.jobs.docs.if, /needs\.release\.outputs\.release-record != ''/u)
  assert.deepEqual(docs.on.push.branches, ['main'])
  assert.equal(docs.jobs.deploy.with.channel, '${{ github.event_name == \'push\' && \'preview\' || inputs.channel }}')
  assert.equal(docs.jobs.deploy.with['source-sha'], '${{ github.event_name == \'push\' && github.sha || inputs.source-sha }}')
  assert.deepEqual(Object.keys(deploy.on), ['workflow_call'])
  assert.equal(deploy.concurrency['cancel-in-progress'], false)
  assert.equal(deploy.concurrency.group, 'docs-${{ inputs.site }}-${{ inputs.channel }}')
  assert.equal(deploy.jobs.deploy.environment, deploy.concurrency.group)
  assert.notEqual(site.preview.url, site.stable.url)
  for (const gate of ['build', 'check:publish', 'lint', 'typecheck', 'tsd', 'test', 'test:release']) {
    assert.ok(releaseConfig.qualityScripts.includes(gate), `Release verification must retain ${gate}`)
  }
})

test('staged lint routes root and docs filenames intact without touching the real index', async (t) => {
  const { directory, cwd } = await temporaryRepository(t)
  const rootFile = 'packages/core/space \'quote.ts'
  const docsFile = 'apps/docs/content/docs/it\'s a guide.mdx'
  await write(cwd, rootFile, 'export const value = 1\n')
  await write(cwd, docsFile, '# Guide\n')
  await write(cwd, 'ignored.png', 'image')
  git(cwd, 'add', '--all')
  await write(cwd, 'unstaged.ts', 'export const ignored = 1\n')
  const before = git(cwd, 'diff', '--cached', '--binary')
  const bin = path.join(directory, 'bin')
  const record = path.join(directory, 'commands.jsonl')
  await mkdir(bin)
  const shim = path.join(bin, process.platform === 'win32' ? 'pnpm.js' : 'pnpm')
  await writeFile(shim, '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.AUTOMATION_COMMAND_LOG, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + "\\n")\n')
  if (process.platform === 'win32') {
    await writeFile(path.join(bin, 'pnpm.cmd'), `@"${process.execPath}" "${shim}" %*\r\n`)
  }
  else {
    await chmod(shim, 0o755)
  }
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href, path.join(repository, 'scripts/staged-lint.ts')], {
    cwd,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env['PATH']}`, AUTOMATION_COMMAND_LOG: record },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const commands = (await readFile(record, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(commands, [
    { cwd, args: ['exec', 'eslint', '--fix', '--no-warn-ignored', '--', rootFile] },
    { cwd: path.join(cwd, 'apps/docs'), args: ['exec', 'eslint', '--fix', '--no-warn-ignored', '--', docsFile.slice('apps/docs/'.length)] },
  ])
  assert.equal(git(cwd, 'diff', '--cached', '--binary'), before)
})

async function prepareHooksFixture(cwd: string, installDependency = false) {
  const manifest = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'))
  assert.equal(manifest.scripts.prepare, 'node scripts/prepare-hooks.ts')
  await write(cwd, 'package.json', JSON.stringify({ type: 'module', scripts: { prepare: manifest.scripts.prepare } }))
  await write(cwd, '.gitignore', 'node_modules/\n')
  await mkdir(path.join(cwd, 'scripts'), { recursive: true })
  await copyFile(path.join(repository, 'scripts/prepare-hooks.ts'), path.join(cwd, 'scripts/prepare-hooks.ts'))
  await copyFile(path.join(repository, 'lefthook.yml'), path.join(cwd, 'lefthook.yml'))
  if (installDependency) {
    await mkdir(path.join(cwd, 'node_modules'), { recursive: true })
    await symlink(path.dirname(require.resolve('lefthook/package.json')), path.join(cwd, 'node_modules/lefthook'), 'junction')
  }
}

function runPrepareHooks(cwd: string, overrides: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key === 'CI' || key.startsWith('LEFTHOOK') || key.startsWith('GIT_')) {
      delete env[key]
    }
  }
  return spawnSync(process.execPath, ['scripts/prepare-hooks.ts'], {
    cwd,
    env: { ...env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...overrides },
    encoding: 'utf8',
    timeout: 30_000,
  })
}

test('prepare skips CI, explicit opt-out and source archives before resolving Lefthook', async (t) => {
  const { cwd } = await temporaryRepository(t)
  await prepareHooksFixture(cwd)
  for (const env of [{ CI: 'true' }, { CI: '1' }, { LEFTHOOK: '0' }, { LEFTHOOK: 'false' }]) {
    const result = runPrepareHooks(cwd, env)
    assert.equal(result.status, 0, result.stderr)
    await assert.rejects(readFile(path.join(cwd, '.git/hooks/pre-commit')), { code: 'ENOENT' })
  }
  // Even inside a parent checkout, an archive must not install the parent's hooks.
  const archive = path.join(cwd, 'archive')
  await prepareHooksFixture(archive)
  const result = runPrepareHooks(archive)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /outside a Git checkout/)
  await assert.rejects(readFile(path.join(cwd, '.git/hooks/pre-commit')), { code: 'ENOENT' })
})

test('prepare installs real Lefthook hooks in developer checkouts and linked worktrees', async (t) => {
  const { cwd, directory } = await temporaryRepository(t)
  await prepareHooksFixture(cwd, true)
  git(cwd, 'add', '--all')
  git(cwd, 'commit', '--quiet', '-m', 'test: prepare developer hook fixture')
  const hookFiles = ['pre-commit', 'commit-msg', 'pre-push'].map(hook => path.join(cwd, '.git/hooks', hook))
  for (const ci of ['false', '0']) {
    const result = runPrepareHooks(cwd, { CI: ci })
    assert.equal(result.status, 0, result.stderr)
    for (const file of hookFiles) {
      assert.match(await readFile(file, 'utf8'), /lefthook/)
    }
  }
  const worktree = path.join(directory, 'worktree')
  git(cwd, 'worktree', 'add', '--quiet', '--detach', worktree, 'HEAD')
  await prepareHooksFixture(worktree, true)
  assert.match(await readFile(path.join(worktree, '.git'), 'utf8'), /^gitdir:/)
  await Promise.all(hookFiles.map(file => rm(file)))
  const result = runPrepareHooks(worktree)
  assert.equal(result.status, 0, result.stderr)
  for (const file of hookFiles) {
    assert.match(await readFile(file, 'utf8'), /lefthook/)
  }
})

test('prepare preserves real hook installation failures', async (t) => {
  const { cwd } = await temporaryRepository(t)
  await prepareHooksFixture(cwd)
  const missing = runPrepareHooks(cwd)
  assert.notEqual(missing.status, 0, 'A developer checkout requires the installed Lefthook dependency')
  assert.match(missing.stderr, /Cannot find module/)
  await prepareHooksFixture(cwd, true)
  await writeFile(path.join(cwd, 'lefthook.yml'), 'pre-commit: [invalid YAML\n')
  const malformed = runPrepareHooks(cwd)
  assert.notEqual(malformed.status, 0, 'A broken hook configuration must not make installation look successful')
  assert.match(`${malformed.stdout}\n${malformed.stderr}`, /yaml|config/i)
})

test('package consumers match Node null export boundaries while retaining types and real runtime failures', async (t) => {
  const { cwd } = await temporaryRepository(t)
  await write(cwd, 'package.json', JSON.stringify({ name: 'exports-fixture-workspace', private: true }))
  await write(cwd, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  const targets = {
    '.': null,
    './empty': [],
    './nested': [{ unknown: './dist/blocked.mjs' }, null],
    './array-fallback': [null, './dist/allowed.mjs'],
    './unmatched': { unknown: './dist/blocked.mjs' },
  }
  const mappings = Object.fromEntries(Object.entries(targets).map(([subpath, node]) => [subpath, {
    import: { types: './dist/index.d.mts', node, default: subpath === './unmatched' ? './dist/allowed.mjs' : './dist/blocked.mjs' },
    require: {
      types: './dist/index.d.cts',
      node: JSON.parse(JSON.stringify(node).replaceAll('.mjs', '.cjs')),
      default: subpath === './unmatched' ? './dist/allowed.cjs' : './dist/blocked.cjs',
    },
  }]))
  const name = 'fixture-conditional-targets'
  const pkg = path.join(cwd, 'packages/conditional')
  await write(pkg, 'package.json', JSON.stringify({ name, version: '1.0.0', type: 'module', exports: mappings, files: ['dist'] }))
  for (const extension of ['mts', 'cts']) {
    await write(pkg, `dist/index.d.${extension}`, 'export declare const value: number\n')
  }
  await write(pkg, 'dist/allowed.mjs', 'export const value = 42\n')
  await write(pkg, 'dist/allowed.cjs', 'exports.value = 42\n')
  for (const extension of ['mjs', 'cjs']) {
    await write(pkg, `dist/blocked.${extension}`, 'throw new Error("Bundler hook required")\n')
  }
  await mkdir(path.join(cwd, 'node_modules'))
  await symlink(pkg, path.join(cwd, 'node_modules', name), 'junction')
  for (const subpath of Object.keys(targets)) {
    const specifier = `${name}${subpath === '.' ? '' : subpath.slice(1)}`
    for (const format of ['module', 'commonjs']) {
      const expression = format === 'module' ? `(await import(${JSON.stringify(specifier)})).value` : `require(${JSON.stringify(specifier)}).value`
      const actual = spawnSync(process.execPath, ['--input-type', format, '--eval', `console.log(${expression})`], { cwd, encoding: 'utf8' })
      if (subpath === './array-fallback' || subpath === './unmatched') {
        assert.equal(actual.status, 0, actual.stderr)
        assert.equal(actual.stdout.trim(), '42')
      }
      else {
        assert.notEqual(actual.status, 0)
        assert.match(actual.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/)
        assert.doesNotMatch(actual.stderr, /Bundler hook required/)
      }
    }
  }

  const broken = path.join(cwd, 'packages/broken')
  await write(broken, 'package.json', JSON.stringify({ name: 'fixture-runtime-failure', version: '1.0.0', type: 'module', exports: './index.mjs' }))
  await write(broken, 'index.mjs', 'throw new Error("Genuine runtime failure")\n')
  const report = await checkPackages({ cwd })
  if (report.temporaryDirectory) {
    t.after(() => rm(report.temporaryDirectory!, { recursive: true, force: true }))
  }
  const valid = report.packages.find(result => result.name === name)
  assert.ok(valid)
  assert.equal(valid.status, 'passed', JSON.stringify(valid.diagnostics))
  const runtimeChecks = valid.commands.filter(command => command.args.includes('--eval'))
  assert.equal(runtimeChecks.length, 4, 'Only the two supported Node subpaths should execute in both formats')
  const typeChecks = valid.commands.filter(command => command.args.includes('--noEmit'))
  assert.equal(typeChecks.length, 10, 'Both type declaration formats remain checked for all five subpaths')
  const invalid = report.packages.find(result => result.name === 'fixture-runtime-failure')
  assert.equal(invalid?.status, 'failed')
  assert.ok(invalid?.diagnostics.some(diagnostic => diagnostic.code === 'RUNTIME_IMPORT' && diagnostic.message.includes('Genuine runtime failure')))
})
