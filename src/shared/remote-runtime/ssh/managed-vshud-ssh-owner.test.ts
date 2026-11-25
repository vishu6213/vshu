import { describe, expect, it } from 'vitest'
import {
  getLegacyManagedVshudOwnerEnvironmentId,
  getManagedVshudFenceEnvironmentId,
  isEphemeralRuntimeSshOwner
} from './managed-vshud-ssh-owner'

describe('managed vshud SSH fence', () => {
  it('reads the fence from vshudFence, never from owner', () => {
    expect(getManagedVshudFenceEnvironmentId({ vshudFence: { environmentId: 'env-1' } })).toBe(
      'env-1'
    )
    const legacyOnly = {
      vshudFence: undefined,
      owner: { type: 'on-demand-runtime' as const, runtimeId: 'managed-vshud:old' }
    }
    expect(getManagedVshudFenceEnvironmentId({ ...legacyOnly })).toBeNull()
    expect(
      getManagedVshudFenceEnvironmentId({ ...legacyOnly, vshudFence: { environmentId: 'env-2' } })
    ).toBe('env-2')
    expect(getManagedVshudFenceEnvironmentId(undefined)).toBeNull()
  })

  it('recognises the legacy owner fence only so loading can migrate it', () => {
    const legacy = { type: 'on-demand-runtime' as const, runtimeId: 'managed-vshud:env-1' }
    expect(getLegacyManagedVshudOwnerEnvironmentId(legacy)).toBe('env-1')
    expect(isEphemeralRuntimeSshOwner(legacy)).toBe(false)
  })

  it('keeps ordinary on-demand runtime targets ephemeral', () => {
    const owner = { type: 'on-demand-runtime' as const, runtimeId: 'runtime-1' }
    expect(getLegacyManagedVshudOwnerEnvironmentId(owner)).toBeNull()
    expect(isEphemeralRuntimeSshOwner(owner)).toBe(true)
  })
})
