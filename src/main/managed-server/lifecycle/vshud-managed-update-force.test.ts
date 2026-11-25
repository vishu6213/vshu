import { describe, expect, it } from 'vitest'
import type { VshudTerminalCensus } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-terminal-census'
import { emptyVshudActivationRecord } from '../activation/vshud-activation-record'
import { CURRENT_VSHUD_DAEMON_PROTOCOL } from '../activation/vshud-daemon-protocol-crossing'
import { planVshudUpdate } from '../activation/vshud-update-plan'
import { managedVshudUpdateForce } from './vshud-managed-update-decision'

// What a released vshud answers when its daemon never started: no session or in-process count.
const OLDER_SERVER_UNCOUNTED: VshudTerminalCensus = {
  liveSessions: null,
  startedSinceActivation: null,
  daemonProtocolVersion: null,
  answered: true
}

function planWith(force: ReturnType<typeof managedVshudUpdateForce>) {
  return planVshudUpdate({
    record: { ...emptyVshudActivationRecord(), active: 'v1' },
    candidateVersion: 'v2',
    census: OLDER_SERVER_UNCOUNTED,
    candidateDaemonProtocol: CURRENT_VSHUD_DAEMON_PROTOCOL,
    // The candidate proved no daemon alive: the only terminals left run inside vshud.
    hostDaemonProtocols: [],
    force
  })
}

describe('managedVshudUpdateForce', () => {
  it('keeps a bare force (CLI --force) deferring over an uncounted census', () => {
    const force = managedVshudUpdateForce({ force: true })
    expect(force).toBe('live-terminals')
    expect(planWith(force)).toMatchObject({ action: 'defer', forceable: true })
  })

  it('lets a confirmed force (CLI --force --yes) pass once no daemon is alive', () => {
    const force = managedVshudUpdateForce({ force: true, endInProcessTerminals: true })
    expect(force).toBe(true)
    expect(planWith(force)).toMatchObject({ action: 'proceed', preservesLiveDaemon: false })
  })

  it('ignores the confirmation without force', () => {
    expect(managedVshudUpdateForce({ force: false, endInProcessTerminals: true })).toBe(false)
    expect(managedVshudUpdateForce({ endInProcessTerminals: true })).toBeUndefined()
  })

  it('keeps the desktop Update anyway levels', () => {
    expect(
      managedVshudUpdateForce({
        force: true,
        pastLiveTerminals: { incumbentVersion: 'v1', uncounted: true }
      })
    ).toBe(true)
    expect(managedVshudUpdateForce({ pastLiveTerminals: { incumbentVersion: 'v1' } })).toBe(
      'live-terminals'
    )
  })
})
