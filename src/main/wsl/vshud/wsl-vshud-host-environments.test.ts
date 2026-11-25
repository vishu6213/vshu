import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import {
  observeWslVshudHostResponse,
  onWslVshudHostAutomationsChanged,
  registerWslVshudHostEnvironment,
  unregisterWslVshudHostEnvironment,
  wslVshudHostSupports
} from './wsl-vshud-host-environments'

const CAPABILITY = 'agent-session.account-env.v1'

function status(capabilities: string[]): RuntimeRpcResponse<unknown> {
  return { id: 'status.get', ok: true, result: { capabilities }, _meta: { runtimeId: 'r' } }
}

describe('wslVshudHostSupports', () => {
  afterEach(() => unregisterWslVshudHostEnvironment('env-1', 'Ubuntu'))

  it('reports an older host as unsupported and a failed probe as unknown', async () => {
    registerWslVshudHostEnvironment('env-1', 'Ubuntu')
    await expect(wslVshudHostSupports('env-1', CAPABILITY, async () => status([]))).resolves.toBe(
      'unsupported'
    )
    registerWslVshudHostEnvironment('env-1', 'Ubuntu')
    await expect(
      wslVshudHostSupports('env-1', CAPABILITY, async () => {
        throw new Error('offline')
      })
    ).resolves.toBe('unknown')
    const failure: RuntimeRpcResponse<unknown> = {
      id: 'status.get',
      ok: false,
      error: { code: 'x', message: 'x' }
    }
    await expect(wslVshudHostSupports('env-1', CAPABILITY, async () => failure)).resolves.toBe(
      'unknown'
    )
  })

  it("follows a renderer's status.get and forgets it on reconnect", async () => {
    registerWslVshudHostEnvironment('env-1', 'Ubuntu')
    observeWslVshudHostResponse('env-1', 'status.get', status([]))
    const readStatus = vi.fn(async () => status([CAPABILITY]))
    await expect(wslVshudHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('unsupported')
    observeWslVshudHostResponse('env-1', 'terminal.list', status([CAPABILITY]))
    await expect(wslVshudHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('unsupported')
    // A reconnect may be a redeployed vshud.
    registerWslVshudHostEnvironment('env-1', 'Ubuntu')
    await expect(wslVshudHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('supported')
  })

  it('records nothing for an environment that is not a WSL vshud', async () => {
    observeWslVshudHostResponse('ssh-1', 'status.get', status([CAPABILITY]))
    await expect(wslVshudHostSupports('ssh-1', CAPABILITY, async () => status([]))).resolves.toBe(
      'unknown'
    )
  })
})

describe('onWslVshudHostAutomationsChanged (E9)', () => {
  afterEach(() => unregisterWslVshudHostEnvironment('env-1', 'Ubuntu'))

  it('tells the wake schedule when this desktop changed a WSL host’s automations', () => {
    registerWslVshudHostEnvironment('env-1', 'Ubuntu')
    const listener = vi.fn()
    const stop = onWslVshudHostAutomationsChanged(listener)
    const ok = (id: string): RuntimeRpcResponse<unknown> => ({
      id,
      ok: true,
      result: {},
      _meta: { runtimeId: 'r' }
    })
    observeWslVshudHostResponse('env-1', 'automation.delete', ok('automation.delete'))
    observeWslVshudHostResponse('env-1', 'automation.update', ok('automation.update'))
    observeWslVshudHostResponse('env-1', 'automation.list', ok('automation.list'))
    observeWslVshudHostResponse('ssh-box', 'automation.create', ok('automation.create'))
    expect(listener.mock.calls).toEqual([['env-1'], ['env-1']])
    stop()
  })
})
