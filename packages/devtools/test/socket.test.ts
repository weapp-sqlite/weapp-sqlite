import type { SqliteDevtoolsSocketHandlers, SqliteDevtoolsWeappSocketTask } from '../src/socket'
import { describe, expect, it, vi } from 'vitest'
import { createWeappSocketFactory, createWebSocketFactory } from '../src/socket'

function handlers() {
  return {
    open: vi.fn(),
    message: vi.fn(),
    close: vi.fn(),
    error: vi.fn(),
  } satisfies SqliteDevtoolsSocketHandlers
}

function weappTaskHarness() {
  let open: (() => void) | undefined
  let message: ((event: { data: string | ArrayBuffer }) => void) | undefined
  let close: (() => void) | undefined
  let error: (() => void) | undefined
  const task: SqliteDevtoolsWeappSocketTask = {
    send: vi.fn(),
    close: vi.fn(),
    onOpen: vi.fn((handler) => { open = handler }),
    onMessage: vi.fn((handler) => { message = handler }),
    onClose: vi.fn((handler) => { close = handler }),
    onError: vi.fn((handler) => { error = handler }),
  }
  return {
    task,
    emitOpen: () => open?.(),
    emitMessage: (event: { data: string | ArrayBuffer }) => message?.(event),
    emitClose: () => close?.(),
    emitError: () => error?.(),
  }
}

describe('WebSocket adapters', () => {
  it('decodes WebSocket ArrayBuffer frames and reports synchronous send failures', () => {
    let message: ((event: { data?: unknown }) => void) | undefined
    let close: (() => void) | undefined
    const send = vi.fn(() => { throw new Error('closed') })
    const Constructor = class {
      readonly close = vi.fn()
      send = send
      addEventListener(type: string, handler: (event: { data?: unknown }) => void) {
        if (type === 'message') { message = handler }
        if (type === 'close') { close = () => handler({}) }
      }
    } as unknown as new (url: string) => {
      send: (data: string) => void
      close: () => void
      addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => void
    }
    const next = handlers()
    const socket = createWebSocketFactory(Constructor)('ws://test', next)
    const frame = new TextEncoder().encode('{"type":"ready"}')
    message?.({ data: frame.buffer })
    expect(next.message).toHaveBeenCalledWith('{"type":"ready"}')

    socket.send('request')
    expect(next.error).toHaveBeenCalledTimes(1)
    socket.send('request-again')
    expect(send).toHaveBeenCalledTimes(1)
    close?.()
    expect(next.close).not.toHaveBeenCalled()
  })

  it('handles a constructor failure without throwing from the factory', () => {
    const next = handlers()
    const Constructor = class {
      constructor() { throw new Error('unsupported') }
      send() {}
      close() {}
      addEventListener() {}
    } as unknown as new (url: string) => {
      send: (data: string) => void
      close: () => void
      addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => void
    }
    expect(() => createWebSocketFactory(Constructor)('ws://test', next)).not.toThrow()
    expect(next.error).toHaveBeenCalledTimes(1)
  })

  it('does not emit stale WebSocket events after an explicit close', () => {
    const events = new Map<string, (event: { data?: unknown }) => void>()
    const close = vi.fn()
    const Constructor = class {
      send = vi.fn()
      close = close
      addEventListener(type: string, handler: (event: { data?: unknown }) => void) { events.set(type, handler) }
    } as unknown as new (url: string) => {
      send: (data: string) => void
      close: () => void
      addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => void
    }
    const next = handlers()
    const socket = createWebSocketFactory(Constructor)('ws://test', next)
    socket.close()
    socket.close()
    events.get('open')?.({})
    events.get('message')?.({ data: 'ignored' })
    events.get('error')?.({})
    events.get('close')?.({})
    expect(close).toHaveBeenCalledTimes(1)
    expect(next.open).not.toHaveBeenCalled()
    expect(next.message).not.toHaveBeenCalled()
    expect(next.error).not.toHaveBeenCalled()
    expect(next.close).not.toHaveBeenCalled()
  })
})

describe('wx.connectSocket adapter', () => {
  it('closes a task when connectSocket invokes fail synchronously', () => {
    const harness = weappTaskHarness()
    const next = handlers()
    const socket = createWeappSocketFactory({
      connectSocket(options) {
        options.fail()
        return harness.task
      },
    })('ws://test', next)

    expect(next.error).toHaveBeenCalledTimes(1)
    expect(harness.task.close).toHaveBeenCalledTimes(1)
    expect(() => socket.close()).not.toThrow()
  })

  it('decodes ArrayBuffer frames and turns send failure into one error', () => {
    const harness = weappTaskHarness()
    const next = handlers()
    vi.mocked(harness.task.send).mockImplementation((options) => { options.fail?.() })
    const socket = createWeappSocketFactory({ connectSocket: () => harness.task })('ws://test', next)
    const frame = new TextEncoder().encode('{"type":"request"}')
    harness.emitMessage({ data: frame.buffer })
    expect(next.message).toHaveBeenCalledWith('{"type":"request"}')

    socket.send('request')
    expect(next.error).toHaveBeenCalledTimes(1)
    expect(harness.task.close).toHaveBeenCalledTimes(1)
    socket.send('request-again')
    expect(harness.task.send).toHaveBeenCalledTimes(1)
  })

  it('keeps explicit close idempotent and suppresses stale task events', () => {
    const harness = weappTaskHarness()
    const next = handlers()
    const socket = createWeappSocketFactory({ connectSocket: () => harness.task })('ws://test', next)
    socket.close()
    socket.close()
    harness.emitOpen()
    harness.emitMessage({ data: 'ignored' })
    harness.emitError()
    harness.emitClose()
    expect(harness.task.close).toHaveBeenCalledTimes(1)
    expect(next.open).not.toHaveBeenCalled()
    expect(next.message).not.toHaveBeenCalled()
    expect(next.error).not.toHaveBeenCalled()
    expect(next.close).not.toHaveBeenCalled()
  })
})
