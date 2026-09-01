import type { Plugin } from 'weapp-vite'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { weappSqlite } from '@/plugin'

function hook<T extends keyof Plugin>(plugin: Plugin, name: T) {
  const value = plugin[name]
  if (typeof value !== 'function') {
    throw new TypeError(`Expected ${String(name)} to be a plugin hook function.`)
  }
  return value as unknown as (...args: unknown[]) => unknown
}

describe('weappSqlite plugin', () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('generates a target-specialized runtime and emits only its WASM asset', async () => {
    const plugin = weappSqlite({ debug: true })
    hook(plugin, 'configResolved').call({}, {
      weappVite: { name: 'weapp-vite', runtime: 'miniprogram', platform: 'alipay' },
    } as never)
    const resolved = await hook(plugin, 'resolveId').call({}, 'virtual:weapp-sqlite-runtime')
    const source = String(await hook(plugin, 'load').call({}, resolved))
    expect(source).toContain('platform: "alipay"')
    expect(source).toContain('typeof my')
    expect(source).not.toContain('WXWebAssembly')

    const emitFile = vi.fn()
    await hook(plugin, 'buildStart').call({ emitFile })
    expect(emitFile).toHaveBeenCalledOnce()
    expect(emitFile.mock.calls[0]?.[0]).toMatchObject({ fileName: 'assets/sql-wasm.wasm' })
  })

  it('uses the browser adapter and browser-only WASM for Web builds', async () => {
    const plugin = weappSqlite()
    hook(plugin, 'configResolved').call({}, {
      weappVite: { name: 'weapp-vite', runtime: 'web', platform: 'web' },
    } as never)
    const resolved = await hook(plugin, 'resolveId').call({}, 'virtual:weapp-sqlite-runtime')
    const source = String(await hook(plugin, 'load').call({}, resolved))
    expect(source).toContain('createWebSqliteRuntimeAdapter')
    expect(source).toContain('sql-wasm-browser.wasm')
  })

  it('selects the lite engine and asset for every target', async () => {
    const plugin = weappSqlite({ wasm: { variant: 'lite' } })
    hook(plugin, 'configResolved').call({}, {
      weappVite: { name: 'weapp-vite', runtime: 'web', platform: 'web' },
    } as never)
    const resolved = await hook(plugin, 'resolveId').call({}, 'virtual:weapp-sqlite-runtime')
    const source = String(await hook(plugin, 'load').call({}, resolved))
    expect(source).toContain('@weapp-sqlite/sqljs/lite')
    expect(source).toContain('engine: "sql.js-wasm-lite"')
    expect(source).toContain('/assets/sql-wasm-lite.wasm')

    const emitFile = vi.fn()
    await hook(plugin, 'buildStart').call({ emitFile })
    expect(emitFile.mock.calls[0]?.[0]).toMatchObject({ fileName: 'assets/sql-wasm-lite.wasm' })
  })

  it('rejects builds that are not owned by weapp-vite', async () => {
    const plugin = weappSqlite()
    await expect(hook(plugin, 'configResolved').call({}, {} as never)).rejects.toThrow('requires a weapp-vite single-target')
  })

  it('generates a marker-owned debug subpackage through auto routes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-plugin-'))
    temporaryDirectories.push(root)
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src/sqlite-debug.config.ts'), 'export default {}')
    await writeFile(path.join(root, 'src/app.json'), '{"pages":["pages/index/index"]}')
    const plugin = weappSqlite({ debug: { enabled: true, page: { route: '__debug/index/index', configFile: './src/sqlite-debug.config.ts' } } })
    const userConfig = { root, weapp: { srcRoot: 'src' } }
    const config = await hook(plugin, 'config').call({}, userConfig) as { weapp: { autoRoutes: { include: string[] }, subPackages: Record<string, unknown> } }

    expect(config.weapp.autoRoutes.include).toContain('__debug/**')
    expect(config.weapp.subPackages).toHaveProperty('__debug')
    await expect(readFile(path.join(root, 'src/__debug/index/index.ts'), 'utf8')).resolves.toContain('createSqliteDebugWorkspacePage')
    await hook(plugin, 'closeBundle').call({})
    await expect(readFile(path.join(root, 'src/__debug/index/index.ts'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('invalidates the compiler app manifest after registering the generated route', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-plugin-manifest-'))
    temporaryDirectories.push(root)
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src/sqlite-debug.config.ts'), 'export default {}')
    const plugin = weappSqlite({ debug: { enabled: true, page: { route: '__debug/index/index', configFile: './src/sqlite-debug.config.ts' } } })
    await hook(plugin, 'config').call({}, { root, weapp: { srcRoot: 'src' } })
    const markRoutesDirty = vi.fn()
    const ensureRoutesFresh = vi.fn()
    const markManifestDirty = vi.fn()
    const loadManifest = vi.fn()

    await hook(plugin, 'configResolved').call({}, {
      weappVite: { name: 'weapp-vite', runtime: 'miniprogram', platform: 'weapp' },
      plugins: [{
        name: 'weapp-vite:context',
        api: {
          ctx: {
            configService: { weappViteConfig: {} },
            autoRoutesService: { markDirty: markRoutesDirty, ensureFresh: ensureRoutesFresh },
            scanService: { markDirty: markManifestDirty, loadAppEntry: loadManifest },
          },
        },
      }],
    } as never)

    expect(markRoutesDirty).toHaveBeenCalledOnce()
    expect(ensureRoutesFresh).toHaveBeenCalledOnce()
    expect(markManifestDirty).toHaveBeenCalledOnce()
    expect(loadManifest).toHaveBeenCalledOnce()
    expect(ensureRoutesFresh.mock.invocationCallOrder[0]).toBeLessThan(markManifestDirty.mock.invocationCallOrder[0] as number)
  })

  it('never overwrites user files at the configured debug route', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-plugin-conflict-'))
    temporaryDirectories.push(root)
    await mkdir(path.join(root, 'src/__debug/index'), { recursive: true })
    await writeFile(path.join(root, 'src/sqlite-debug.config.ts'), 'export default {}')
    await writeFile(path.join(root, 'src/__debug/index/index.ts'), 'Page({})')
    const plugin = weappSqlite({ debug: { enabled: true, page: { route: '__debug/index/index', configFile: './src/sqlite-debug.config.ts' } } })
    await expect(hook(plugin, 'config').call({}, { root, weapp: { srcRoot: 'src' } })).rejects.toThrow('conflicts with user files')
  })

  it('generates and cleans a marker-owned SQLite WASM subpackage', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-wasm-package-'))
    temporaryDirectories.push(root)
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src/app.json.ts'), 'import { subPackages } from \'weapp-vite/auto-routes\'\nexport default { subPackages }\n')
    const plugin = weappSqlite({ wasm: { variant: 'lite', weappPackage: { mode: 'generated-subpackage' } } })
    await hook(plugin, 'config').call({}, { root, weapp: { srcRoot: 'src' } })
    const markRoutesDirty = vi.fn()
    const ensureRoutesFresh = vi.fn()
    const markManifestDirty = vi.fn()
    const loadManifest = vi.fn(async () => ({ json: {} }))
    await hook(plugin, 'configResolved').call({}, {
      root,
      weappVite: { name: 'weapp-vite', runtime: 'miniprogram', platform: 'weapp' },
      plugins: [{
        name: 'weapp-vite:context',
        api: {
          ctx: {
            configService: { weappViteConfig: {} },
            autoRoutesService: { markDirty: markRoutesDirty, ensureFresh: ensureRoutesFresh },
            scanService: { markDirty: markManifestDirty, loadAppEntry: loadManifest },
          },
        },
      }],
    } as never)

    const loader = await readFile(path.join(root, 'src/__weapp_sqlite_loader__/index.ts'), 'utf8')
    expect(loader).toContain('require.async("../__weapp_sqlite__/runtime.ts")')
    expect(loader).toContain('initializerPromise ??=')
    await expect(readFile(path.join(root, 'src/__weapp_sqlite__/runtime.ts'), 'utf8')).resolves.toContain('@weapp-sqlite/sqljs/lite')
    expect(markRoutesDirty).toHaveBeenCalledOnce()

    const emitFile = vi.fn()
    await hook(plugin, 'buildStart').call({ emitFile })
    expect(emitFile.mock.calls[0]?.[0]).toMatchObject({ fileName: '__weapp_sqlite__/assets/sql-wasm-lite.wasm' })
    const bundle = {
      'common.js': { type: 'chunk', fileName: 'common.js', code: 'require.async("../__weapp_sqlite__/runtime.js")' },
      'pages/index/index.js': { type: 'chunk', fileName: 'pages/index/index.js', code: 'require.async("../__weapp_sqlite__/runtime.js")' },
    }
    await hook(plugin, 'generateBundle').call({}, {}, bundle)
    expect(bundle['common.js'].code).toBe('require.async("./__weapp_sqlite__/runtime.js")')
    expect(bundle['pages/index/index.js'].code).toBe('require.async("../../__weapp_sqlite__/runtime.js")')
    await hook(plugin, 'closeBundle').call({})
    vi.advanceTimersByTime(30_000)
    await expect(readFile(path.join(root, 'src/__weapp_sqlite__/runtime.ts'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(root, 'src/__weapp_sqlite_loader__/index.ts'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('binds SQLite assets to an existing normal subpackage', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-existing-package-'))
    temporaryDirectories.push(root)
    await mkdir(path.join(root, 'src/orders/pages'), { recursive: true })
    const plugin = weappSqlite({ wasm: { weappPackage: { mode: 'existing-subpackage', root: 'orders' } } })
    await hook(plugin, 'config').call({}, { root, weapp: { srcRoot: 'src' } })
    await hook(plugin, 'configResolved').call({}, {
      root,
      weappVite: { name: 'weapp-vite', runtime: 'miniprogram', platform: 'weapp' },
      plugins: [{
        name: 'weapp-vite:context',
        api: { ctx: { scanService: { loadAppEntry: async () => ({ json: { subPackages: [{ root: 'orders', pages: ['pages/index'] }] } }) } } },
      }],
    } as never)
    await expect(readFile(path.join(root, 'src/orders/__weapp_sqlite__/runtime.ts'), 'utf8')).resolves.toContain('@weapp-sqlite/sqljs/full')
    await expect(readFile(path.join(root, 'src/__weapp_sqlite_loader__/index.ts'), 'utf8')).resolves.toContain('require.async("../orders/__weapp_sqlite__/runtime.ts")')
    const emitFile = vi.fn()
    await hook(plugin, 'buildStart').call({ emitFile })
    expect(emitFile.mock.calls[0]?.[0]).toMatchObject({ fileName: 'orders/assets/sql-wasm.wasm' })
    await hook(plugin, 'closeBundle').call({})
    vi.advanceTimersByTime(30_000)
    await expect(readdir(path.join(root, 'src/orders/pages'))).resolves.toEqual([])
  })

  it('rejects missing, independent, and invalid subpackage roots', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-invalid-package-'))
    temporaryDirectories.push(root)
    const resolve = (plugin: Plugin, subPackages: unknown[]) => hook(plugin, 'configResolved').call({}, {
      root,
      weappVite: { name: 'weapp-vite', runtime: 'miniprogram', platform: 'weapp' },
      plugins: [{
        name: 'weapp-vite:context',
        api: { ctx: { scanService: { loadAppEntry: async () => ({ json: { subPackages } }) } } },
      }],
    } as never)

    await expect(resolve(weappSqlite({ wasm: { weappPackage: { mode: 'existing-subpackage', root: '../orders' } } }), [])).rejects.toThrow('Invalid')
    await expect(resolve(weappSqlite({ wasm: { weappPackage: { mode: 'existing-subpackage', root: 'orders' } } }), [])).rejects.toThrow('missing')
    await expect(resolve(weappSqlite({ wasm: { weappPackage: { mode: 'existing-subpackage', root: 'orders' } } }), [{ root: 'orders', independent: true }])).rejects.toThrow('independent')
  })

  it('ignores WeChat package placement for non-WeChat targets', async () => {
    const plugin = weappSqlite({ wasm: { variant: 'lite', weappPackage: { mode: 'existing-subpackage', root: 'orders' } } })
    hook(plugin, 'configResolved').call({}, {
      weappVite: { name: 'weapp-vite', runtime: 'miniprogram', platform: 'alipay' },
    } as never)
    const emitFile = vi.fn()
    await hook(plugin, 'buildStart').call({ emitFile })
    expect(emitFile.mock.calls[0]?.[0]).toMatchObject({ fileName: 'assets/sql-wasm-lite.wasm' })
  })

  it('never overwrites user files at generated SQLite WASM paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'weapp-sqlite-wasm-conflict-'))
    temporaryDirectories.push(root)
    await mkdir(path.join(root, 'src/__weapp_sqlite__'), { recursive: true })
    await writeFile(path.join(root, 'src/__weapp_sqlite__/user.ts'), 'export {}')
    await writeFile(path.join(root, 'src/app.json.ts'), 'import \'weapp-vite/auto-routes\'\nexport default {}\n')
    const plugin = weappSqlite({ wasm: { weappPackage: { mode: 'generated-subpackage' } } })
    await expect(hook(plugin, 'config').call({}, { root, weapp: { srcRoot: 'src' } })).rejects.toThrow('conflicts with user files')
  })
})
