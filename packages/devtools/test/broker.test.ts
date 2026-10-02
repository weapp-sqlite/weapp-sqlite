import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createSqliteDevtoolsBroker } from '../src/broker'
import { encodeSqliteDevtoolsValue, isSqliteDevtoolsMethod } from '../src/protocol'

describe('SQLite DevTools runtime broker', () => {
  let server: Server | undefined
  let closeBroker: (() => Promise<void>) | undefined

  afterEach(async () => {
    await closeBroker?.()
    await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve())
    closeBroker = undefined
    server = undefined
  })

  it('authenticates a runtime and routes one request to it', async () => {
    const broker = createSqliteDevtoolsBroker({ allowWrite: false })
    closeBroker = broker.close
    server = createServer()
    broker.attach(server)
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address() as import('node:net').AddressInfo
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}${broker.path}`)
    const frames: any[] = []
    socket.on('message', frame => frames.push(JSON.parse(frame.toString())))
    await new Promise<void>(resolve => socket.once('open', () => resolve()))
    socket.send(JSON.stringify({ protocol: 1, type: 'hello', token: broker.token, runtime: { id: 'runtime-1', label: 'Web', platform: 'web' }, databases: ['main'] }))
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    expect(frames[0]?.type).toBe('ready')
    const sessionId = frames[0].sessionId as string
    const invoke = broker.invoke({ runtimeId: 'runtime-1', sessionId, databaseName: 'main', method: 'query', args: encodeSqliteDevtoolsValue(['select 1']) })
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    const request = frames.find(frame => frame.type === 'request')
    socket.send(JSON.stringify({ type: 'result', sessionId, requestId: request.requestId, result: { ok: true, value: encodeSqliteDevtoolsValue({ rows: [] }) } }))
    await expect(invoke).resolves.toMatchObject({ ok: true })
    expect(broker.listRuntimes()[0]?.readOnly).toBe(true)
    socket.close()
  })

  it('exposes query analysis as a read-only protocol method', () => {
    expect(isSqliteDevtoolsMethod('analyzeQuery')).toBe(true)
    expect(isSqliteDevtoolsMethod('getMigrationDiagnostics')).toBe(true)
    expect(isSqliteDevtoolsMethod('getForeignKeyDiagnostics')).toBe(true)
  })
})
