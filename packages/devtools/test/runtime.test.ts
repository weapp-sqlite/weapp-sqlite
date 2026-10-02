import type { SqliteDebugController } from '@weapp-sqlite/debug'
import { describe, expect, it, vi } from 'vitest'
import { decodeSqliteDevtoolsValue } from '../src/protocol'
import { connectSqliteDevtoolsRuntime } from '../src/runtime'

function socketHarness() {
  let handlers: any
  const sent: unknown[] = []
  const socket = {
    send: vi.fn((frame: string) => { sent.push(JSON.parse(frame)) }),
    close: vi.fn(),
  }
  return {
    socket,
    sent,
    factory: vi.fn((_url: string, next: any) => {
      handlers = next
      queueMicrotask(next.open)
      return socket
    }),
    receive: (frame: unknown) => handlers.message(JSON.stringify(frame)),
    close: () => handlers.close(),
  }
}

describe('runtime transport', () => {
  it('registers and serves a controller without opening a Node database', async () => {
    const harness = socketHarness()
    const query = vi.fn(async () => ({ columns: ['n'], rows: [{ n: 1n }] }))
    const controller = { query } as unknown as SqliteDebugController
    connectSqliteDevtoolsRuntime({
      endpoint: 'ws://127.0.0.1:1234/__weapp-sqlite/runtime',
      token: 'secret',
      runtime: { id: 'web-1', label: 'Web', platform: 'web' },
      listDatabases: () => ['main'],
      getController: () => controller,
      createSocket: harness.factory,
    })
    await new Promise<void>(resolve => queueMicrotask(resolve))
    const hello = harness.sent[0] as any
    expect(hello.type).toBe('hello')
    harness.receive({ type: 'ready', sessionId: 'session-1', allowWrite: true })
    harness.receive({ type: 'request', sessionId: 'session-1', requestId: 'r1', databaseName: 'main', method: 'query', args: { type: 'array', value: ['select'] } })
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(query).toHaveBeenCalledWith('select')
    const result = harness.sent.at(-1) as any
    expect(result.type).toBe('result')
    expect(decodeSqliteDevtoolsValue(result.result.value)).toEqual({ columns: ['n'], rows: [{ n: 1n }] })
  })

  it('does not replay requests after disconnect', async () => {
    const harness = socketHarness()
    const controller = { query: vi.fn(async () => ({ columns: [], rows: [] })) } as unknown as SqliteDebugController
    connectSqliteDevtoolsRuntime({ endpoint: 'ws://127.0.0.1:1234/runtime', token: 'secret', runtime: { id: 'web-2', label: 'Web', platform: 'web' }, listDatabases: () => ['main'], getController: () => controller, createSocket: harness.factory })
    await new Promise<void>(resolve => queueMicrotask(() => resolve(undefined)))
    harness.receive({ type: 'ready', sessionId: 's', allowWrite: true })
    harness.close()
    expect(controller.query).not.toHaveBeenCalled()
  })
})
