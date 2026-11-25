import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VshuRuntimeService } from '../../vshu-runtime'
import { eraseRpcMethods, isStreamingMethod } from '../core'
import { denyRpcMethodForCaller } from '../callers/rpc-caller-scope'
import { MOBILE_RPC_METHOD_ALLOWLIST } from '../server/runtime-rpc-mobile-method-allowlist'
import {
  installVshuServerSignIn,
  VshuServerSignIn
} from '../../../vshu-profiles/vshu-server-sign-in'
import { VSHU_ACCOUNT_METHODS } from './vshu-account'

function requestMethod(name: string) {
  const found = eraseRpcMethods(VSHU_ACCOUNT_METHODS).find((candidate) => candidate.name === name)
  if (!found || isStreamingMethod(found)) {
    throw new Error(`Missing request method ${name}`)
  }
  return found
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these handlers read no runtime member.
const runtime = {} as unknown as VshuRuntimeService

afterEach(() => installVshuServerSignIn(null))

describe('Vshu account RPC methods', () => {
  it('needs exactly the power to run commands on the host, for every caller kind', () => {
    for (const method of VSHU_ACCOUNT_METHODS) {
      expect(method.permission).toBe('workspace')
      expect(MOBILE_RPC_METHOD_ALLOWLIST.has(method.name)).toBe(true)
      expect(
        denyRpcMethodForCaller({ kind: 'mobile', delegated: true }, method.name, 'workspace')
      ).toBeNull()
      expect(
        denyRpcMethodForCaller({ kind: 'runtime-paired', grants: [] }, method.name, 'workspace')
      ).toBeNull()
    }
  })

  it('tells an older-host caller to update when the host has no account sign-in', async () => {
    await expect(
      requestMethod('vshuAccount.status').handler(undefined, { runtime })
    ).rejects.toThrow('Signing in to Vshu is not available on this host. Update Vshu on it.')
  })

  it('refuses a flow to a transport that cannot name its caller', async () => {
    installVshuServerSignIn(
      new VshuServerSignIn({
        account: {
          getAuthStatus: vi.fn(),
          signInWithCode: vi.fn(),
          selectOrg: vi.fn(),
          signOut: vi.fn(),
          refreshAuth: vi.fn()
        }
      })
    )
    await expect(
      requestMethod('vshuAccount.signIn.start').handler({}, { runtime, clientKind: 'runtime' })
    ).rejects.toThrow('This client cannot sign this host in.')
  })

  it('starts the flow for the calling device', async () => {
    const server = new VshuServerSignIn({
      account: {
        getAuthStatus: vi.fn(),
        signInWithCode: vi.fn(),
        selectOrg: vi.fn(),
        signOut: vi.fn(),
        refreshAuth: vi.fn()
      }
    })
    const start = vi.spyOn(server, 'startSignIn').mockReturnValue({
      flowId: 'flow-1',
      provider: 'switch-account',
      revision: 1,
      phase: 'starting'
    })
    installVshuServerSignIn(server)

    await requestMethod('vshuAccount.signIn.start').handler(
      { switchAccount: true },
      { runtime, caller: { kind: 'paired-device', deviceId: 'phone-1' } }
    )

    expect(start).toHaveBeenCalledWith('phone-1', 'switch-account', {
      approveInBrowser: undefined
    })
    await requestMethod('vshuAccount.signIn.start').handler(
      { approveInBrowser: true },
      { runtime, caller: { kind: 'paired-device', deviceId: 'phone-1' } }
    )
    expect(start).toHaveBeenLastCalledWith('phone-1', 'sign-in', { approveInBrowser: true })
  })
})
