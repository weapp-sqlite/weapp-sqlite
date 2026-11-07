import type { Plugin } from 'vite'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { weappSqlite } from '@/plugin'

function hook(plugin: Plugin, name: keyof Plugin) {
  const value = plugin[name]
  if (typeof value !== 'function') {
    throw new TypeError(`Expected ${String(name)} to be a function.`)
  }
  return value as (...args: unknown[]) => unknown
}

describe('SQLite generated source ownership across config changes', () => {
  const directories: string[] = []
  const plugins: Plugin[] = []

  afterEach(async () => {
    for (const plugin of plugins.splice(0)) {
      await hook(plugin, 'closeWatcher').call({})
    }
    await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
  })

  async function prepare(mode: 'existing-subpackage' | 'generated-subpackage', packageRoot: string, projectRoot?: string) {
    const root = projectRoot ?? await mkdtemp(path.join(tmpdir(), 'sqlite-config-ownership-'))
    if (!projectRoot) {
      directories.push(root)
    }
    const plugin = weappSqlite({ wasm: { weappPackage: { mode, root: packageRoot } } })
    plugins.push(plugin)
    await hook(plugin, 'config').call({}, { root, weapp: { srcRoot: 'src' } })
    await hook(plugin, 'configResolved').call({}, {
      root,
      command: 'build',
      mode: 'development',
      build: {},
      plugins: [{
        name: 'weapp-vite:context',
        api: { ctx: {
          configService: { isDev: true, weappViteConfig: {} },
          autoRoutesService: { markDirty() {}, async ensureFresh() {} },
          scanService: { markDirty() {}, async loadAppEntry() { return { json: { subPackages: [{ root: packageRoot, pages: ['entry/index'] }] } } } },
        } },
      }],
      weappVite: { name: 'weapp-vite', runtime: 'miniprogram', platform: 'weapp' },
    })
    const directory = path.join(root, 'src', packageRoot, ...(mode === 'existing-subpackage' ? ['weapp-sqlite'] : []))
    return {
      root,
      plugin,
      directory,
      runtime: path.join(directory, 'runtime.ts'),
      loader: path.join(root, 'src/weapp-sqlite-loader/index.ts'),
    }
  }

  it.each(['existing-subpackage', 'generated-subpackage'] as const)('cleans both roots after switching the %s root with a shared loader', async (mode) => {
    const previous = await prepare(mode, 'root-a')
    const current = await prepare(mode, 'root-b', previous.root)
    await hook(previous.plugin, 'closeWatcher').call({})
    await expect(readFile(current.runtime, 'utf8')).resolves.toContain('@weapp-sqlite/sqljs/full')
    await expect(readFile(current.loader, 'utf8')).resolves.toContain('../root-b/')
    await hook(current.plugin, 'closeWatcher').call({})
    await expect(readFile(previous.runtime)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(current.runtime)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(current.loader)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cleans the old generated root after switching the same root to existing-subpackage mode', async () => {
    const previous = await prepare('generated-subpackage', 'root-a')
    const current = await prepare('existing-subpackage', 'root-a', previous.root)
    await hook(previous.plugin, 'closeWatcher').call({})
    await expect(readFile(current.runtime, 'utf8')).resolves.toContain('@weapp-sqlite/sqljs/full')
    await expect(readFile(current.loader, 'utf8')).resolves.toContain('../root-a/weapp-sqlite/runtime.ts')
    await hook(current.plugin, 'closeWatcher').call({})
    await expect(readFile(previous.runtime)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(current.runtime)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(current.loader)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves user-owned old roots and existing pages while the new owner cleans its own sources', async () => {
    const previous = await prepare('generated-subpackage', 'root-a')
    const marker = path.join(previous.directory, '.weapp-sqlite-generated')
    await writeFile(marker, 'user-owned\n')
    const current = await prepare('existing-subpackage', 'root-a', previous.root)
    const page = path.join(previous.directory, 'pages/user.ts')
    await mkdir(path.dirname(page), { recursive: true })
    await writeFile(page, 'Page({})\n')
    await hook(previous.plugin, 'closeWatcher').call({})
    await hook(current.plugin, 'closeWatcher').call({})
    await expect(readFile(marker, 'utf8')).resolves.toBe('user-owned\n')
    await expect(readFile(page, 'utf8')).resolves.toBe('Page({})\n')
    await expect(readFile(current.runtime)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(current.loader)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
