import type { Plugin } from 'weapp-vite'
import { weappSqlite } from '@/plugin'

function hook<T extends keyof Plugin>(plugin: Plugin, name: T) {
  const value = plugin[name]
  if (typeof value !== 'function') {
    throw new TypeError(`Expected ${String(name)} to be a plugin hook function.`)
  }
  return value as unknown as (...args: unknown[]) => unknown
}

describe('weappSqlite plugin', () => {
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

  it('rejects builds that are not owned by weapp-vite', () => {
    const plugin = weappSqlite()
    expect(() => hook(plugin, 'configResolved').call({}, {} as never)).toThrow('requires a weapp-vite single-target')
  })
})
