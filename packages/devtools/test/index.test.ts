import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSqliteDevtoolsDevframe,
  createSqliteDevtoolsPlugin,
  startSqliteDevtoolsServer,
} from '../src/index'

const clientAssets = fileURLToPath(new URL('../client/', import.meta.url))

describe('SQLite DevTools host lifecycle', () => {
  const started: Array<{ close: () => Promise<void> }> = []

  afterEach(async () => {
    await Promise.all(started.splice(0).map(server => server.close()))
  })

  it('serves the panel, reuses the released port, and makes close idempotent', async () => {
    const first = await startSqliteDevtoolsServer({ clientAssets, port: 0 })
    started.push(first)
    const panelUrl = new URL(first.url)
    const runtimeUrl = new URL(first.runtimeEndpoint.replace(/^ws:/, 'http:'))

    expect(panelUrl.pathname).toBe('/__weapp-sqlite/')
    expect(runtimeUrl.pathname).toBe('/__weapp-sqlite/runtime')
    expect(runtimeUrl.port).toBe(panelUrl.port)
    expect(first.runtimeToken).toHaveLength(64)
    expect((await fetch(first.url.split('#')[0]!)).status).toBe(200)

    await Promise.all([first.close(), first.close()])
    started.splice(started.indexOf(first), 1)

    const second = await startSqliteDevtoolsServer({ clientAssets, port: Number(runtimeUrl.port) })
    started.push(second)
    expect(new URL(second.runtimeEndpoint).port).toBe(runtimeUrl.port)
  })

  it('exposes an awaited closeServer hook for Vite host shutdown', async () => {
    const controller = createSqliteDevtoolsDevframe({ clientAssets })
    const dispose = vi.spyOn(controller, 'dispose')
    const plugin = createSqliteDevtoolsPlugin(controller)
    const vite = await createServer({
      configFile: false,
      root: process.cwd(),
      clearScreen: false,
      logLevel: 'silent',
      plugins: [plugin],
      server: { host: '127.0.0.1', port: 0 },
    })

    await vite.listen()
    await vite.close()

    expect(dispose).toHaveBeenCalled()
    await controller.dispose()
  })

  it('coalesces concurrent controller disposal', async () => {
    const controller = createSqliteDevtoolsDevframe()
    const first = controller.dispose()
    const second = controller.dispose()

    expect(second).toBe(first)
    await first
  })
})
