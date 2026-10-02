import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createSqliteDevtoolsBroker } from '../src/broker'
import { encodeSqliteDevtoolsValue, isSqliteDevtoolsMethod } from '../src/protocol'

async function waitForFrame(socket: WebSocket, frames: readonly any[], predicate: (frame: any) => boolean) {
  const existing = frames.find(predicate)
  if (existing) { return existing }

  return new Promise<any>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>
    let onMessage: (data: WebSocket.RawData) => void
    let onClose: () => void
    function cleanup() {
      clearTimeout(timeout)
      socket.off('message', onMessage)
      socket.off('close', onClose)
    }
    onMessage = (data: WebSocket.RawData) => {
      const frame = JSON.parse(data.toString())
      if (!predicate(frame)) { return }
      cleanup()
      resolve(frame)
    }
    onClose = () => {
      cleanup()
      reject(new Error('Runtime socket closed before the expected frame arrived.'))
    }
    timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for a runtime frame.'))
    }, 1000)
    socket.on('message', onMessage)
    socket.once('close', onClose)
  })
}

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
    const ready = await waitForFrame(socket, frames, frame => frame.type === 'ready')
    const sessionId = ready.sessionId as string
    await expect(broker.invoke({ runtimeId: 'runtime-1', sessionId, databaseName: 'main', method: 'close', args: encodeSqliteDevtoolsValue([]) })).resolves.toMatchObject({
      ok: false,
      error: { code: 'SQLITE_DEVTOOLS_INVALID_REQUEST' },
    })
    expect(socket.readyState).toBe(WebSocket.OPEN)
    const invoke = broker.invoke({ runtimeId: 'runtime-1', sessionId, databaseName: 'main', method: 'query', args: encodeSqliteDevtoolsValue(['select 1']) })
    const request = await waitForFrame(socket, frames, frame => frame.type === 'request')
    socket.send(JSON.stringify({ type: 'result', sessionId, requestId: request.requestId, result: { ok: true, value: encodeSqliteDevtoolsValue({ rows: [] }) } }))
    await expect(invoke).resolves.toMatchObject({ ok: true })
    expect(broker.listRuntimes()[0]?.readOnly).toBe(true)

    const release = broker.releaseSession({ runtimeId: 'runtime-1', sessionId })
    const releaseRequest = await waitForFrame(socket, frames, frame => frame.type === 'release')
    socket.send(JSON.stringify({ type: 'release-result', sessionId, requestId: releaseRequest.requestId, result: { ok: true, value: encodeSqliteDevtoolsValue(undefined) } }))
    await expect(release).resolves.toMatchObject({ ok: true })
    expect(socket.readyState).toBe(WebSocket.OPEN)
    socket.close()
  })

  it('exposes query analysis as a read-only protocol method', () => {
    expect(isSqliteDevtoolsMethod('analyzeQuery')).toBe(true)
    expect(isSqliteDevtoolsMethod('getMigrationDiagnostics')).toBe(true)
    expect(isSqliteDevtoolsMethod('getForeignKeyDiagnostics')).toBe(true)
  })
})
