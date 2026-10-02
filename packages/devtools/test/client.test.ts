import { authenticateWithUrlOtp, getDevframeRpcClient } from 'devframe/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectDevtoolsClient } from '../src/client'

vi.mock('devframe/client', () => ({
  authenticateWithUrlOtp: vi.fn(),
  getDevframeRpcClient: vi.fn(),
}))

function rpcHarness(isTrusted: boolean) {
  const scoped = {
    call: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
    register: vi.fn(),
    unregister: vi.fn(),
  }
  return {
    rpc: {
      isTrusted,
      status: 'connected',
      events: { on: vi.fn() },
      scope: vi.fn(() => ({ rpc: scoped })),
      close: vi.fn(),
    },
    scoped,
  }
}

describe('Devframe client authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses a host trusted session without requiring a panel URL OTP', async () => {
    const harness = rpcHarness(true)
    vi.mocked(getDevframeRpcClient).mockResolvedValue(harness.rpc as never)
    vi.mocked(authenticateWithUrlOtp).mockResolvedValue(false)

    const client = await connectDevtoolsClient()

    expect(authenticateWithUrlOtp).not.toHaveBeenCalled()
    await client.dispose()
  })

  it('exchanges an OTP when the host has not authorized the panel', async () => {
    const harness = rpcHarness(false)
    vi.mocked(getDevframeRpcClient).mockResolvedValue(harness.rpc as never)
    vi.mocked(authenticateWithUrlOtp).mockImplementation(async () => {
      harness.rpc.isTrusted = true
      return true
    })

    const client = await connectDevtoolsClient()

    expect(authenticateWithUrlOtp).toHaveBeenCalledOnce()
    await client.dispose()
  })

  it('releases runtime debug sessions before closing the Devframe RPC', async () => {
    const harness = rpcHarness(true)
    const runtime = { id: 'web-1', label: 'Web', platform: 'web', databases: ['main'], sessionId: 'session-1', connectedAt: 'now', readOnly: false }
    harness.scoped.call.mockImplementation(async (name: unknown) => name === 'list-runtimes' ? [runtime] : [])
    vi.mocked(getDevframeRpcClient).mockResolvedValue(harness.rpc as never)

    const client = await connectDevtoolsClient()
    await client.listRuntimes()
    const first = client.dispose()
    const second = client.dispose()
    expect(second).toBe(first)
    await first

    expect(harness.scoped.call).toHaveBeenCalledWith('release-session', { runtimeId: 'web-1', sessionId: 'session-1' })
    expect(harness.scoped.unregister).toHaveBeenCalledOnce()
    expect(harness.rpc.close).toHaveBeenCalledOnce()
  })
})
