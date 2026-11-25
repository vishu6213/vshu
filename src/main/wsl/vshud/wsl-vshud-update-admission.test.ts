import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { VshudActivationRecord } from '../../managed-server/activation/vshud-activation-record'
import { recordVshudUpdateFailedThisLaunch } from '../../managed-server/lifecycle/vshud-managed-update-failure-memory'
import type { ServeReadiness } from '../../server/serve-readiness'

import type { VshudSlotOptions } from '../../managed-server/activation/vshud-recovery-slot'
import { getRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { admitWslVshudUpdate } from './wsl-vshud-update-admission'

const { adoptRunningVshudVersion, readVshudActivationRecord } = vi.hoisted(() => ({
  adoptRunningVshudVersion: vi.fn(),
  readVshudActivationRecord: vi.fn()
}))

vi.mock('../../managed-server/activation/vshud-running-version-adoption', () => ({
  adoptRunningVshudVersion
}))
vi.mock('../../managed-server/activation/vshud-activation-record-store', () => ({
  readVshudActivationRecord
}))

// Mixed versions between this desktop and a WSL distro's vshud: they update independently.
const OLDER = '1.5.0+aaaaaaaaaaaa'
const NEWER = '1.6.0+bbbbbbbbbbbb'
const slot: VshudSlotOptions = {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every host call is mocked at its module.
  conn: {} as VshudSlotOptions['conn'],
  host: getRemoteHostPlatform('linux-x64'),
  remoteHome: '/home/u',
  nodePath: '',
  userDataDir: '/home/u/.vshu',
  bindHost: '127.0.0.1',
  port: 6768
}
const readiness: ServeReadiness = {
  runtimeId: 'wsl-runtime',
  boundEndpoint: '127.0.0.1:6768',
  advertisedEndpoint: null,
  managedWslCliReconciliation: 'settled',
  pairing: { available: false, reason: 'disabled_by_operator', guidance: '' }
}
let hostSeq = 0

function running(version: string, appVersion: string): VshudActivationRecord {
  return {
    schemaVersion: 1,
    active: version,
    previous: null,
    activatedAt: '2026-10-01T00:00:00.000Z',
    snapshot: null,
    activeAppVersion: appVersion
  }
}

function admit(
  record: VshudActivationRecord,
  desktop: { candidateVersion: string; appVersion: string },
  options: { intent?: 'connect' | 'update' | 'force'; host?: { kind: 'wsl'; id: string } } = {}
) {
  return admitWslVshudUpdate({
    slot,
    record,
    ...desktop,
    host: options.host ?? { kind: 'wsl', id: `Ubuntu-${(hostSeq += 1)}` },
    intent: options.intent ?? 'connect'
  })
}

beforeEach(() => {
  adoptRunningVshudVersion.mockReset()
  readVshudActivationRecord.mockReset()
})

describe('WSL vshud admission across desktop and host versions', () => {
  describe('an older desktop meets the vshud a newer desktop deployed', () => {
    const olderDesktop = { candidateVersion: OLDER, appVersion: '1.5.0' }

    it('keeps the newer vshud serving its terminals, with no Update hint', async () => {
      adoptRunningVshudVersion.mockResolvedValue({ version: NEWER, readiness, reprobe: vi.fn() })
      for (const intent of ['connect', 'update'] as const) {
        expect(await admit(running(NEWER, '1.6.0'), olderDesktop, { intent })).toEqual({
          action: 'serve',
          version: NEWER,
          readiness,
          deferredUpdate: null
        })
      }
      expect(adoptRunningVshudVersion).toHaveBeenCalledWith(slot, running(NEWER, '1.6.0'), OLDER)
    })
  })

  describe('a newer desktop meets the vshud an older desktop deployed', () => {
    const newerDesktop = { candidateVersion: NEWER, appVersion: '1.6.0' }

    it('keeps the older vshud serving after a failed update, and offers Force', async () => {
      const host = { kind: 'wsl' as const, id: 'Ubuntu-failed' }
      recordVshudUpdateFailedThisLaunch(host, { code: 'vshud_activation_failed', reason: 'boom' })
      adoptRunningVshudVersion.mockResolvedValue({ version: OLDER, readiness, reprobe: vi.fn() })
      expect(await admit(running(OLDER, '1.5.0'), newerDesktop, { host })).toEqual({
        action: 'serve',
        version: OLDER,
        readiness,
        deferredUpdate: {
          candidateVersion: NEWER,
          code: 'vshud_activation_failed',
          reason: 'boom',
          forceable: true
        }
      })
    })
  })
})
