import type { Plugin } from 'vite'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createSqliteDevtoolsHost } from '@/devtools-plugin'
import { weappSqlite } from '@/plugin'

vi.mock('@/devtools-plugin', () => ({
  createSqliteDevtoolsHost: vi.fn(() => ({
    start: vi.fn(async () => ({ url: 'http://sqlite-devtools.invalid', runtimeEndpoint: 'ws://sqlite-devtools.invalid/runtime', runtimeToken: 'test-only' })),
    close: vi.fn(async () => {}),
  })),
}))

function hook(plugin: Plugin, name: keyof Plugin) {
  const value = plugin[name]
  if (typeof value !== 'function') {
    throw new TypeError(`Expected ${String(name)} to be a function.`)
  }
  return value as (...args: unknown[]) => unknown
}

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? await filesIn(file) : [file]
  }))).flat().sort()
}

describe('SQLite generated source lifetime', () => {
  const directories: string[] = []
  const plugins: Plugin[] = []

  afterEach(async () => {
    for (const plugin of plugins.splice(0)) {
      await hook(plugin, 'closeWatcher').call({})
    }
    vi.useRealTimers()
    await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
  })

  async function prepare(mode: 'existing-subpackage' | 'generated-subpackage', options: { root?: string, isDev?: boolean, variant?: 'full' | 'lite', command?: 'build' | 'serve', watch?: boolean } = {}) {
    const root = options.root ?? await mkdtemp(path.join(tmpdir(), 'sqlite-classic-lifecycle-'))
    if (!options.root) {
      directories.push(root)
    }
    const plugin = weappSqlite({ wasm: { variant: options.variant ?? 'lite', weappPackage: { mode, root: 'sqlite-runtime' } } })
    plugins.push(plugin)
    await hook(plugin, 'config').call({}, { root, weapp: { srcRoot: 'src' } })
    await hook(plugin, 'configResolved').call({}, {
      root,
      command: options.command ?? 'build',
      mode: 'development',
      build: options.watch ? { watch: {} } : {},
      plugins: [{
        name: 'weapp-vite:context',
        api: { ctx: {
          configService: { isDev: options.isDev ?? true, weappViteConfig: {} },
          autoRoutesService: { markDirty() {}, async ensureFresh() {} },
          scanService: { markDirty() {}, async loadAppEntry() { return { json: { subPackages: [{ root: 'sqlite-runtime', pages: ['entry/index'] }] } } } },
        } },
      }],
      weappVite: { name: 'weapp-vite', runtime: 'miniprogram', platform: 'weapp' },
    })
    return { root, plugin, files: await filesIn(path.join(root, 'src')) }
  }

  it.each(['existing-subpackage', 'generated-subpackage'] as const)('does not rewrite identical generated sources across %s generations', async (mode) => {
    const first = await prepare(mode)
    const oldTime = new Date('2000-01-01T00:00:00.000Z')
    await Promise.all(first.files.map(file => utimes(file, oldTime, oldTime)))
    const second = await prepare(mode, { root: first.root })
    expect(second.files).toEqual(first.files)
    for (const file of first.files) {
      expect((await stat(file)).mtimeMs, path.relative(first.root, file)).toBe(oldTime.getTime())
    }
  })

  it.each(['existing-subpackage', 'generated-subpackage'] as const)('keeps %s sources through classic snapshot closeBundle and 120 seconds', async (mode) => {
    vi.useFakeTimers()
    const { plugin, files } = await prepare(mode)
    await hook(plugin, 'closeBundle').call({})
    await vi.advanceTimersByTimeAsync(120_000)
    for (const file of files) {
      await expect(readFile(file)).resolves.toBeInstanceOf(Buffer)
    }
    await hook(plugin, 'closeWatcher').call({})
    await expect(readFile(files[0]!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('transfers ownership without allowing an older build timer or watcher to delete the active generation', async () => {
    vi.useFakeTimers()
    const baseline = process.listenerCount('exit')
    const previous = await prepare('existing-subpackage', { isDev: false })
    await hook(previous.plugin, 'closeBundle').call({})
    const current = await prepare('existing-subpackage', { root: previous.root })
    expect(process.listenerCount('exit')).toBe(baseline + 1)
    await hook(previous.plugin, 'closeWatcher').call({})
    await vi.advanceTimersByTimeAsync(120_000)
    for (const file of current.files) {
      await expect(readFile(file)).resolves.toBeInstanceOf(Buffer)
    }
    await hook(current.plugin, 'closeWatcher').call({})
    expect(process.listenerCount('exit')).toBe(baseline)
  })

  it('uses directories that are included by the WeChat runtime', async () => {
    const { root, files } = await prepare('generated-subpackage')
    const segments = files.flatMap(file => path.relative(root, path.dirname(file)).split(path.sep))
    expect(segments.filter(segment => /^__.*__$/.test(segment))).toEqual([])
  })

  it('updates changed runtime content without touching unchanged loader or marker files', async () => {
    const first = await prepare('existing-subpackage')
    const oldTime = new Date('2000-01-01T00:00:00.000Z')
    await Promise.all(first.files.map(file => utimes(file, oldTime, oldTime)))
    await prepare('existing-subpackage', { root: first.root, variant: 'full' })
    for (const file of first.files) {
      if (path.basename(file) === 'runtime.ts') {
        await expect(readFile(file, 'utf8')).resolves.toContain('@weapp-sqlite/sqljs/full')
      }
      else {
        expect((await stat(file)).mtimeMs).toBe(oldTime.getTime())
      }
    }
  })

  it('propagates marker read errors instead of treating every failure as a missing marker', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sqlite-marker-io-error-'))
    directories.push(root)
    await mkdir(path.join(root, 'src/sqlite-runtime/.weapp-sqlite-generated'), { recursive: true })
    const plugin = weappSqlite({ wasm: { weappPackage: { mode: 'generated-subpackage', root: 'sqlite-runtime' } } })
    plugins.push(plugin)
    await expect(hook(plugin, 'config').call({}, { root })).rejects.toMatchObject({ code: 'EISDIR' })
    await rm(path.join(root, 'src/sqlite-runtime/.weapp-sqlite-generated'), { recursive: true })
  })

  it('retains ownership after cleanup fails so the same owner can retry', async () => {
    const current = await prepare('existing-subpackage')
    const marker = current.files.find(file => file.endsWith('.weapp-sqlite-generated'))!
    const content = await readFile(marker)
    await rm(marker)
    await mkdir(marker)
    await expect(hook(current.plugin, 'closeWatcher').call({})).rejects.toMatchObject({ code: 'EISDIR' })
    await rm(marker, { recursive: true })
    await writeFile(marker, content)
    await hook(current.plugin, 'closeWatcher').call({})
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('waits for an in-flight old cleanup before preparing the next generation', async () => {
    const previous = await prepare('existing-subpackage')
    const closing = hook(previous.plugin, 'closeWatcher').call({})
    const current = await prepare('existing-subpackage', { root: previous.root })
    await closing
    for (const file of current.files) {
      await expect(readFile(file)).resolves.toBeInstanceOf(Buffer)
    }
  })

  it('retains native watch resources until closeWatcher and releases actual serve resources at closeBundle', async () => {
    const watch = await prepare('existing-subpackage', { isDev: false, watch: true })
    await hook(watch.plugin, 'closeBundle').call({})
    for (const file of watch.files) {
      await expect(readFile(file)).resolves.toBeInstanceOf(Buffer)
    }
    await hook(watch.plugin, 'closeWatcher').call({})
    await expect(readFile(watch.files[0]!)).rejects.toMatchObject({ code: 'ENOENT' })
    const serve = await prepare('existing-subpackage', { isDev: false, command: 'serve' })
    await hook(serve.plugin, 'closeBundle').call({})
    await expect(readFile(serve.files[0]!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('migrates the old default package only when its ownership marker matches', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sqlite-legacy-default-'))
    directories.push(root)
    await mkdir(path.join(root, 'src/__weapp_sqlite__'), { recursive: true })
    await writeFile(path.join(root, 'src/__weapp_sqlite__/.weapp-sqlite-generated'), 'weapp-sqlite-wasm-subpackage-v1\n')
    const plugin = weappSqlite({ wasm: { weappPackage: { mode: 'generated-subpackage' } } })
    plugins.push(plugin)
    await hook(plugin, 'config').call({}, { root })
    await expect(readdir(path.join(root, 'src/__weapp_sqlite__'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(root, 'src/weapp-sqlite/entry/index.ts'), 'utf8')).resolves.toBe('Page({})\n')
  })

  it('preserves strict main-build compiler and target diagnostics', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sqlite-strict-main-context-'))
    directories.push(root)
    const plugin = weappSqlite({ wasm: { weappPackage: { mode: 'existing-subpackage', root: 'shared' } } })
    plugins.push(plugin)
    await hook(plugin, 'config').call({}, { root })
    await expect(hook(plugin, 'buildStart').call({ emitFile: vi.fn() })).rejects.toThrow('before the target was resolved')
    await expect(hook(plugin, 'configResolved').call({}, {
      root,
      command: 'build',
      plugins: [],
      weappVite: { name: 'weapp-vite', runtime: 'miniprogram', platform: 'weapp' },
    })).rejects.toThrow('require the weapp-vite compiler context')
  })

  it('migrates marker-owned legacy sources and removes the old reserved generated page', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sqlite-legacy-owned-'))
    directories.push(root)
    const marker = 'weapp-sqlite-wasm-subpackage-v1\n'
    for (const directory of ['__weapp_sqlite_loader__', '__weapp_sqlite__', 'sqlite-runtime']) {
      await mkdir(path.join(root, 'src', directory), { recursive: true })
      await writeFile(path.join(root, 'src', directory, '.weapp-sqlite-generated'), marker)
    }
    await mkdir(path.join(root, 'src/sqlite-runtime/__entry__'))
    await writeFile(path.join(root, 'src/sqlite-runtime/__entry__/index.ts'), 'Page({})')
    await prepare('generated-subpackage', { root })
    await expect(readdir(path.join(root, 'src/__weapp_sqlite_loader__'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(path.join(root, 'src/sqlite-runtime/__entry__'))).rejects.toMatchObject({ code: 'ENOENT' })
    // 显式选择另一 root 时，未选择的旧默认分包仍由原配置负责。
    await expect(readFile(path.join(root, 'src/__weapp_sqlite__/.weapp-sqlite-generated'), 'utf8')).resolves.toBe(marker)
  })

  it('preserves legacy user files and relinquishes directories whose marker changed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sqlite-legacy-user-'))
    directories.push(root)
    await mkdir(path.join(root, 'src/__weapp_sqlite_loader__'), { recursive: true })
    const userFile = path.join(root, 'src/__weapp_sqlite_loader__/user.ts')
    await writeFile(userFile, 'export const user = true')
    const current = await prepare('existing-subpackage', { root })
    const marker = current.files.find(file => file.endsWith('.weapp-sqlite-generated'))!
    await writeFile(marker, 'user-owned')
    await hook(current.plugin, 'closeWatcher').call({})
    await expect(readFile(marker, 'utf8')).resolves.toBe('user-owned')
    await expect(readFile(userFile, 'utf8')).resolves.toBe('export const user = true')
  })

  it('keeps the classic debug owner and DevTools host across snapshots and transfers generated page ownership', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(path.join(tmpdir(), 'sqlite-classic-debug-'))
    directories.push(root)
    await mkdir(path.join(root, 'src'))
    await writeFile(path.join(root, 'src/sqlite-debug.config.ts'), 'export default {}')
    const create = async () => {
      const plugin = weappSqlite({ debug: { enabled: true, devtools: true } })
      plugins.push(plugin)
      await hook(plugin, 'config').call({}, { root })
      await hook(plugin, 'configResolved').call({}, {
        root,
        command: 'build',
        mode: 'development',
        build: {},
        logger: { info: vi.fn() },
        plugins: [{ name: 'weapp-vite:context', api: { ctx: {
          configService: { isDev: true, weappViteConfig: {} },
          autoRoutesService: { markDirty() {}, async ensureFresh() {} },
          scanService: { markDirty() {}, async loadAppEntry() { return { json: {} } } },
        } } }],
        weappVite: { name: 'weapp-vite', runtime: 'miniprogram', platform: 'weapp' },
      })
      return plugin
    }
    const previous = await create()
    const host = vi.mocked(createSqliteDevtoolsHost).mock.results.at(-1)!.value
    expect(host.start).toHaveBeenCalledOnce()
    await hook(previous, 'closeBundle').call({})
    expect(host.close).not.toHaveBeenCalled()
    const files = await filesIn(path.join(root, 'src'))
    const oldTime = new Date('2000-01-01T00:00:00.000Z')
    await Promise.all(files.map(file => utimes(file, oldTime, oldTime)))
    const current = await create()
    await hook(previous, 'closeWatcher').call({})
    await vi.advanceTimersByTimeAsync(120_000)
    for (const file of files) {
      expect((await stat(file)).mtimeMs).toBe(oldTime.getTime())
    }
    await hook(current, 'closeWatcher').call({})
    await expect(readFile(path.join(root, 'src/__weapp_sqlite_debug/index/index.ts'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(root, 'src/sqlite-debug.config.ts'), 'utf8')).resolves.toBe('export default {}')
  })
})
