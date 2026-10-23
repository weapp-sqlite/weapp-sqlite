/* eslint-disable test/no-import-node-test -- Native release regressions run independently of workspace builds. */
import type { TestContext } from 'node:test'
import type { NightlyOptions, NightlyReport } from 'repoctl'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

interface NativeNightly {
  confirmNpmNightly: (report: NightlyReport, options: NightlyOptions, allowPending?: boolean) => Promise<void>
  verifyNightlyConsumer: (report: NightlyReport, options: NightlyOptions) => Promise<void>
}

const require = createRequire(import.meta.url)
const nativeRequire = createRequire(require.resolve('repoctl'))
const nativeEntry = nativeRequire.resolve('@icebreakers/monorepo')
const packageRequire = createRequire(nativeEntry)

async function loadNativeNightly(): Promise<NativeNightly> {
  const directory = path.dirname(nativeEntry)
  const commands = (await readdir(directory)).filter(name => /^commands-.*\.mjs$/u.test(name))
  assert.equal(commands.length, 1, 'Update this regression harness when repoctl changes its command bundle')
  const url = pathToFileURL(path.join(directory, commands[0]!))
  url.search = 'nightly-consumer-regression'
  // Expose the installed functions only in this test module instance. Preserve their
  // real imports and import.meta URL without copying implementation or editing node_modules.
  const hooks = registerHooks({
    load(target, context, nextLoad) {
      const loaded = nextLoad(target, context)
      if (target !== url.href) {
        return loaded
      }
      assert.ok(loaded.source)
      const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source as Uint8Array).toString('utf8')
      return { ...loaded, source: `${source}\nexport { confirmNpmNightly, verifyNightlyConsumer };\n` }
    },
  })
  try {
    return await import(url.href) as NativeNightly
  }
  finally {
    hooks.deregister()
  }
}

const native = loadNativeNightly()
const name = '@fixture/nightly-consumer'
const identity = { kind: 'nightly' as const, commit: 'a'.repeat(40), buildId: '101-1' }
const identityKey = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
const version = `1.0.1-snapshot.nightly.c${identity.commit}.b${identityKey}`
const integrity = `sha512-${'a'.repeat(86)}==`
const tarball = `https://registry.npmjs.org/${name}/-/nightly-consumer-${version}.tgz`
const repoctlSnapshot = { ...identity, identityKey, tag: 'snapshot-nightly' }

function reportFixture(directory = ''): NightlyReport {
  return {
    schemaVersion: 1,
    status: 'prepared',
    provider: 'npm',
    repository: 'fixture/nightly',
    branch: 'main',
    eventName: 'workflow_dispatch',
    source: directory,
    commit: identity.commit,
    buildId: identity.buildId,
    packages: [{ name, version, locator: `${name}@snapshot-nightly`, integrity, published: true }],
    commands: [],
    latest: { [name]: '1.0.0' },
    outputDirectory: directory,
    snapshot: {
      schemaVersion: 1,
      identity,
      identityKey,
      source: directory,
      tag: 'snapshot-nightly',
      registry: 'https://registry.npmjs.org/',
      status: 'published',
      nativePlan: {
        schemaVersion: 1,
        branchRule: null,
        cwd: directory,
        pnpmVersion: '12.14.0',
        nativeFormat: 'json',
        status: 'ready',
        packages: [],
        blockers: [],
        notes: { packages: [], entries: [], contributors: [], compareUrls: [] },
      },
      install: { executable: 'pnpm', args: ['add', `${name}@snapshot-nightly`] },
      installCommand: `pnpm add ${name}@snapshot-nightly`,
      packages: [{ name, version, currentVersion: '1.0.0', directory: 'packages/fixture', reasons: ['intent'], integrity, published: true }],
      checks: [{ name, directory: 'packages/fixture', role: 'selected', status: 'passed', files: ['index.mjs', 'index.cjs', 'index.d.mts', 'index.d.cts'], diagnostics: [], commands: [] }],
    },
  }
}

function installationManifest() {
  return { name, version, dist: { integrity, tarball } }
}

type InstallationManifest = ReturnType<typeof installationManifest>

function installationPackument(manifest: InstallationManifest | undefined = installationManifest(), tag = version) {
  return { 'dist-tags': { 'latest': '1.0.0', 'snapshot-nightly': tag }, 'versions': manifest ? { [version]: manifest } : {} }
}

function registryFixture(packuments: ReturnType<typeof installationPackument>[], fullTag = version) {
  let installationReads = 0
  let exactReads = 0
  const registryFetch: typeof fetch = async (input, options) => {
    assert.ok(!options?.method || options.method === 'GET', 'Consumer verification must not mutate the registry')
    const url = new URL(String(input))
    assert.equal(url.origin, 'https://registry.npmjs.org')
    const accept = new Headers(options?.headers).get('accept')
    if (url.pathname === `/${encodeURIComponent(name)}`) {
      assert.equal(accept, 'application/vnd.npm.install-v1+json')
      const packument = packuments[Math.min(installationReads++, packuments.length - 1)]
      assert.ok(packument)
      return Response.json(packument)
    }
    assert.equal(accept, 'application/json')
    if (url.pathname === `/-/package/${encodeURIComponent(name)}/dist-tags`) {
      return Response.json({ 'latest': '1.0.0', 'snapshot-nightly': fullTag })
    }
    assert.equal(url.pathname, `/${encodeURIComponent(name)}/${encodeURIComponent(fullTag)}`)
    exactReads++
    return Response.json({ ...installationManifest(), version: fullTag, repoctlSnapshot })
  }
  return { registryFetch, reads: () => ({ installationReads, exactReads }) }
}

test('nightly confirmation waits for stale install tags and missing expected versions to become ready', async () => {
  const report = reportFixture()
  const registry = registryFixture([
    installationPackument(installationManifest(), '0.0.0-stage'),
    { 'dist-tags': { 'latest': '1.0.0', 'snapshot-nightly': version }, 'versions': {} },
    installationPackument(),
  ])
  const waits: number[] = []
  await (await native).confirmNpmNightly(report, {
    cwd: '',
    registryFetch: registry.registryFetch,
    sleep: async (ms) => {
      waits.push(ms)
    },
  })
  assert.equal(report.confirmed, true)
  assert.equal(waits.length, 2)
  assert.deepEqual(registry.reads(), { installationReads: 3, exactReads: 3 })
})

test('nightly confirmation rejects conflicting installation metadata without retrying', async (t) => {
  const conflicts: Record<string, (manifest: InstallationManifest) => void> = {
    name: (manifest) => { manifest.name = '@fixture/unrelated' },
    version: (manifest) => { manifest.version = '0.0.0-stage' },
    integrity: (manifest) => { manifest.dist.integrity = `sha512-${'b'.repeat(86)}==` },
    tarball: (manifest) => { manifest.dist.tarball = 'https://registry.npmjs.org/fixture/-/wrong.tgz' },
    missingName: (manifest) => { Reflect.deleteProperty(manifest, 'name') },
    missingVersion: (manifest) => { Reflect.deleteProperty(manifest, 'version') },
    missingDist: (manifest) => { Reflect.deleteProperty(manifest, 'dist') },
    missingIntegrity: (manifest) => { Reflect.deleteProperty(manifest.dist, 'integrity') },
    missingTarball: (manifest) => { Reflect.deleteProperty(manifest.dist, 'tarball') },
    emptyTarball: (manifest) => { manifest.dist.tarball = '' },
  }
  for (const [field, mutate] of Object.entries(conflicts)) {
    for (const staleTag of [false, true]) {
      await t.test(`${field}, ${staleTag ? 'stale' : 'current'} tag`, async () => {
        const report = reportFixture()
        const manifest = installationManifest()
        mutate(manifest)
        const registry = registryFixture([installationPackument(manifest, staleTag ? '0.0.0-stage' : version)])
        await assert.rejects((await native).confirmNpmNightly(report, {
          cwd: '',
          registryFetch: registry.registryFetch,
          sleep: async () => { assert.fail('Conflicting artifact metadata must not be retried') },
        }), /installation metadata conflicts/)
        assert.notEqual(report.confirmed, true)
        assert.deepEqual(registry.reads(), { installationReads: 1, exactReads: 1 })
      })
    }
  }
})

test('installation readiness retains the exact metadata identity check', async () => {
  const report = reportFixture()
  const registry = registryFixture([installationPackument()])
  await assert.rejects((await native).confirmNpmNightly(report, {
    cwd: '',
    registryFetch: async (input, options) => {
      const response = await registry.registryFetch(input, options)
      if (new URL(String(input)).pathname.endsWith(`/${encodeURIComponent(version)}`)) {
        const manifest = await response.json()
        manifest.repoctlSnapshot.identityKey = 'b'.repeat(64)
        return Response.json(manifest)
      }
      return response
    },
    sleep: async () => { assert.fail('A conflicting snapshot identity must not be retried') },
  }), /registry evidence conflicts/)
  assert.notEqual(report.confirmed, true)
  assert.deepEqual(registry.reads(), { installationReads: 0, exactReads: 1 })
})

test('the post-consumer check rejects full and abbreviated tag changes immediately', async (t) => {
  for (const surface of ['full', 'abbreviated']) {
    await t.test(surface, async () => {
      const report = reportFixture()
      report.confirmed = true
      const registry = registryFixture([
        installationPackument(installationManifest(), surface === 'abbreviated' ? '0.0.0-stage' : version),
      ], surface === 'full' ? '0.0.0-stage' : version)
      await assert.rejects((await native).confirmNpmNightly(report, {
        cwd: '',
        registryFetch: registry.registryFetch,
        sleep: async () => { assert.fail('A changed channel after consumption must not wait for convergence') },
      }, false), /channel changed after consumer verification/)
      assert.deepEqual(registry.reads(), { installationReads: surface === 'full' ? 0 : 1, exactReads: 1 })
    })
  }
})

async function consumerFixture(t: TestContext, failure?: 'tarball' | 'runtime' | 'types' | 'stale', provider: NightlyReport['provider'] = 'npm') {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-nightly-consumer-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.14.0' }))
  const report = reportFixture(directory)
  report.confirmed = true
  report.provider = provider
  if (provider === 'pkg-pr-new') {
    report.packages[0]!.locator = `https://pkg.pr.new/fixture/nightly/${name}@${identity.commit}`
  }
  const commands: string[][] = []
  let installationDirectory = ''
  let installs = 0
  const options: NightlyOptions = {
    cwd: directory,
    sleep: async () => { assert.fail('Real consumer failures must not be retried') },
    spawn: ((command: string, args: string[], settings: Parameters<typeof spawnSync>[2]) => {
      commands.push([command, ...args])
      if (command !== 'pnpm') {
        assert.equal(command, process.execPath)
        return spawnSync(command, args, { ...settings, stdio: ['ignore', 'pipe', 'pipe'] })
      }
      if (args.includes('--version')) {
        return { status: 0, stdout: '12.14.0\n', stderr: '' }
      }
      assert.ok(args.includes('install'), `Unexpected pnpm command: ${args.join(' ')}`)
      installs++
      installationDirectory = String(settings?.cwd)
      const manifest = JSON.parse(readFileSync(path.join(installationDirectory, 'package.json'), 'utf8'))
      assert.deepEqual(manifest.dependencies, { [name]: provider === 'npm' ? 'snapshot-nightly' : report.packages[0]!.locator }, 'The consumer must exercise the published channel')
      const expectedWorkspace = provider === 'npm' ? {
        packages: [],
        minimumReleaseAgeExclude: [`${name}@${version}`],
      } : { packages: [] }
      assert.deepEqual(parse(readFileSync(path.join(installationDirectory, 'pnpm-workspace.yaml'), 'utf8')), expectedWorkspace, 'Only the confirmed npm batch may bypass release age; no dependency overrides or global minimumReleaseAge setting')
      if (failure === 'tarball') {
        return { status: 1, stdout: '', stderr: `${JSON.stringify({ level: 'error', code: 'ERR_PNPM_TARBALL_IO_ERROR', message: 'Fixture tarball could not be read' })}\n` }
      }
      const installed = path.join(installationDirectory, 'node_modules', name)
      mkdirSync(installed, { recursive: true })
      writeFileSync(path.join(installed, 'package.json'), JSON.stringify({
        name,
        version: failure === 'stale' ? '0.0.0-stage' : version,
        type: 'module',
        repoctlSnapshot,
        exports: { '.': {
          import: { types: './index.d.mts', default: './index.mjs' },
          require: { types: './index.d.cts', default: './index.cjs' },
        } },
      }))
      writeFileSync(path.join(installed, 'index.mjs'), failure === 'runtime' ? 'throw new Error("Actual nightly runtime failure")\n' : 'export const value = 42\n')
      writeFileSync(path.join(installed, 'index.cjs'), 'exports.value = 42\n')
      for (const extension of ['mts', 'cts']) {
        writeFileSync(path.join(installed, `index.d.${extension}`), `export declare const value: ${failure === 'types' ? 'MissingNightlyConsumerType' : 'number'}\n`)
      }
      // Use repoctl's real Node declaration dependency and its own dependency graph.
      const typesDirectory = path.join(installationDirectory, 'node_modules/@types')
      mkdirSync(typesDirectory, { recursive: true })
      symlinkSync(path.dirname(packageRequire.resolve('@types/node/package.json')), path.join(typesDirectory, 'node'), 'junction')
      return { status: 0, stdout: '', stderr: '' }
    }) as NonNullable<NightlyOptions['spawn']>,
  }
  return { report, options, commands, installation: () => ({ installs, directory: installationDirectory }) }
}

test('the native nightly consumer installs the tagged batch with exact release-age exclusions and runs ESM, CJS and TypeScript', async (t) => {
  const fixture = await consumerFixture(t)
  await (await native).verifyNightlyConsumer(fixture.report, fixture.options)
  assert.equal(fixture.report.consumer?.status, 'verified')
  assert.deepEqual(fixture.report.consumer.packages, [{ name, version }])
  assert.equal(fixture.installation().installs, 1)
  assert.equal(fixture.commands.filter(command => command.includes('--eval')).length, 2)
  assert.equal(fixture.commands.filter(command => command.includes('--noEmit')).length, 2)
  await assert.rejects(readdir(fixture.installation().directory), { code: 'ENOENT' })
})

test('the pkg-pr-new consumer keeps its immutable URL and has no npm release-age exclusions', async (t) => {
  const fixture = await consumerFixture(t, undefined, 'pkg-pr-new')
  await (await native).verifyNightlyConsumer(fixture.report, fixture.options)
  assert.equal(fixture.report.consumer?.status, 'verified')
  assert.equal(fixture.installation().installs, 1)
  await assert.rejects(readdir(fixture.installation().directory), { code: 'ENOENT' })
})

test('the native nightly consumer preserves stale-version, tarball, runtime and declaration failures', async (t) => {
  for (const failure of ['stale', 'tarball', 'runtime', 'types'] as const) {
    await t.test(failure, async (t) => {
      const fixture = await consumerFixture(t, failure)
      const message = { stale: /unexpected version or identity/, tarball: /Fixture tarball could not be read/, runtime: /Actual nightly runtime failure/, types: /MissingNightlyConsumerType/ }[failure]
      await assert.rejects((await native).verifyNightlyConsumer(fixture.report, fixture.options), message)
      assert.equal(fixture.report.consumer?.status, 'failed')
      assert.equal(fixture.installation().installs, 1)
      await assert.rejects(readdir(fixture.installation().directory), { code: 'ENOENT' })
    })
  }
})
