import type { Plugin } from 'weapp-vite'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
})
