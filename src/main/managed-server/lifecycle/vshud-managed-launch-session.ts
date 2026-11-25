import type { VshudManagedRestartResult } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import {
  vshudLaunchSshSessionProbeCommand,
  parseVshudLaunchSshSession,
  recordsVshudLaunchSshSession,
  type VshudLaunchSshSession
} from '../install/vshud-launch-ssh-session'
import { withManagedVshudLifecycle } from './vshud-managed-lifecycle'
import {
  managedVshudInstallDir,
  managedVshudSlot,
  requireManagedVshudEnvironment,
  requireManagedVshudInfrastructure,
  resolveLinkedVshudContext
} from './vshud-managed-runtime-context'
import { resolveVshudRemoteContext } from '../install/vshud-remote-context'

import { rebuildVshudManagedTunnel } from './vshud-managed-tunnel'
import { wakeStoppedManagedVshud } from './vshud-managed-wake'
import { vshudSlotDir } from '../activation/vshud-recovery-slot'
import { execVshudRemote } from '../install/vshud-remote-runtime-control'
import { collectManagedTerminalCensus } from './vshud-terminal-census-client'
import { updateTerminalCounts } from '../activation/vshud-fenced-stop'
import { stopIdleVshudForRestart } from './vshud-idle-restart-stop'

export async function readManagedVshudLaunchSshSession(
  userDataPath: string,
  environmentId: string
): Promise<VshudLaunchSshSession> {
  const { deployment } = await requireManagedVshudEnvironment(userDataPath, environmentId)
  const { connectionManager, targetStore } = requireManagedVshudInfrastructure()
  const target = targetStore.getTarget(deployment.sshTargetId)
  // Background checks must not reconnect hosts the user left.
  const connection =
    target && connectionManager.getState(target.id)?.status === 'connected'
      ? (connectionManager.getConnection(target.id) ?? null)
      : null
  if (!target || !connection) {
    return 'unverifiable'
  }
  const context = await resolveVshudRemoteContext(target, connection)
  if (!recordsVshudLaunchSshSession(context.host)) {
    return 'not-applicable'
  }
  const active = context.activationRecord.active
  if (!active) {
    return 'not-recorded'
  }
  return parseVshudLaunchSshSession(
    await execVshudRemote(
      { conn: context.connection, host: context.host },
      vshudLaunchSshSessionProbeCommand(
        context.host,
        managedVshudInstallDir(context, active),
        context.userDataDir
      )
    )
  )
}

/** Restart only without terminals: surviving daemons retain the old SSH-session attribution. */
export async function restartManagedVshudEnvironment(
  userDataPath: string,
  selector: string
): Promise<VshudManagedRestartResult> {
  return await withManagedVshudLifecycle(
    userDataPath,
    selector,
    async ({ environment, deployment }) => {
      const context = await resolveLinkedVshudContext(environment, deployment)
      if (!context.activationRecord.active) {
        return { outcome: 'not-restarted', reason: 'This host has no activated Vshu server.' }
      }
      const counts = updateTerminalCounts((options) =>
        collectManagedTerminalCensus(
          userDataPath,
          environment,
          context.activationRecord,
          undefined,
          options
        )
      )
      // Reject live terminals before waiting for the host lock.
      const census = await counts.countFirst()
      if (census.liveSessions !== 0) {
        return { outcome: 'terminals-running', liveSessions: census.liveSessions }
      }
      const slot = managedVshudSlot(context, deployment.remotePort)
      const stopped = await stopIdleVshudForRestart(slot, counts)
      if (stopped.state === 'terminals-running') {
        return { outcome: 'terminals-running', liveSessions: stopped.liveSessions }
      }
      if (stopped.state === 'kept') {
        return { outcome: 'not-restarted', reason: stopped.reason }
      }
      // Wake even when daemon retirement failed: the stopped server cannot serve clients.
      const wake = await wakeStoppedManagedVshud(slot)
      if (wake.outcome !== 'started' && wake.outcome !== 'serving') {
        return {
          outcome: 'not-restarted',
          reason:
            wake.outcome === 'recovery-refused'
              ? wake.reason
              : `This host’s Vshu server stopped but did not start again (${wake.outcome}); reconnect to start it.`
        }
      }
      // Restart may bind a different port than the existing forward.
      await rebuildVshudManagedTunnel(userDataPath, environment.id)
      const dir = vshudSlotDir(slot, stopped.version)
      if (stopped.state === 'daemon-kept') {
        // A retained daemon keeps old attribution, so preserve the warning.
        return { outcome: 'not-restarted', reason: stopped.reason }
      }
      const session = parseVshudLaunchSshSession(
        await execVshudRemote(
          slot,
          vshudLaunchSshSessionProbeCommand(slot.host, dir, slot.userDataDir)
        )
      )
      if (session === 'exited') {
        return {
          outcome: 'not-restarted',
          reason:
            'This host’s Vshu server restarted, but its terminals still belong to an SSH session ' +
            'that has ended: its terminal daemon was still running, or this connection opens a ' +
            'new SSH session for each command. Turn on SSH connection reuse for this host if ' +
            'it is off, then restart again.'
        }
      }
      return { outcome: 'restarted', environmentId: environment.id }
    }
  )
}
