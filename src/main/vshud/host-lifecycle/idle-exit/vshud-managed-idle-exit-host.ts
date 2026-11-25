import { getAppEnvironment } from '../../../../shared/app-lifecycle/app-environment'
import type { RuntimeRpcClientActivity } from '../../../runtime/rpc/server/runtime-rpc'
import type { VshudIdleExitEvidence } from './vshud-idle-exit-monitor'
import {
  activationFenceExists,
  createVshudIdleProbes,
  installVshudManagedIdleExit,
  resolveVshudManagedIdleExit,
  type VshudManagedIdleExitConfig,
  type VshudManagedIdleExitPorts
} from './vshud-managed-idle-exit'
import type { VshudDaemonRetirement } from '../../daemon/vshud-daemon-retirement'
import { recoverDaemonAfterCancelledIdleStop } from '../../daemon/vshud-idle-stop-daemon-recovery'
import {
  consumeVshudIdleStopRecord,
  discardVshudIdleStopRecord,
  writeVshudIdleStopRecord
} from './vshud-idle-stop-record'
import type { VshudShutdownTrigger } from '../vshud-lifecycle'
import {
  idleStopMayReleaseWslHolder,
  requestVshudWslHolderRelease,
  withdrawVshudWslHolderRelease
} from '../../instance-lock/vshud-wsl-holder-release'
import type { VshudIdleStopRecord } from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-idle-exit'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/host/structured-agent-session-registry'

let requestIdleShutdown: VshudShutdownTrigger | null = null

/** Signal handling binds later; the quiet period must outlast the startup gap. */
export function bindVshudIdleShutdown(request: VshudShutdownTrigger): void {
  requestIdleShutdown = request
}

type VshudIdleExitRuntimePorts = {
  rpc: { readClientActivity(): RuntimeRpcClientActivity }
  agentStates: () => readonly { state: string }[]
  hasStagedMigration: () => boolean
  automationsBusy: () => boolean
  emulatorsBusy: () => Promise<boolean>
  /** Stop the monitor before recording signal-driven shutdown. */
  registerCleanup: (cleanup: () => void) => void
}

/** Under the startup lock, consume previous idle-stop evidence before this run can overwrite it. */
export function beginVshudIdleExit(userDataPath: string): {
  previousIdleStop: VshudIdleStopRecord | null | undefined
  start: (ports: VshudIdleExitRuntimePorts) => Promise<void>
} {
  withdrawVshudWslHolderRelease(userDataPath)
  const config = resolveVshudManagedIdleExit(process.env)
  if (!config) {
    return { previousIdleStop: undefined, start: async () => {} }
  }
  const previousIdleStop = consumeVshudIdleStopRecord(userDataPath)
  if (previousIdleStop) {
    console.error(`[vshud] the previous run stopped idle at ${previousIdleStop.stoppedAt}`)
  }
  const version = getAppEnvironment().getVersion()
  return {
    previousIdleStop,
    start: (ports) => startVshudManagedIdleExit({ ...ports, config, userDataPath, version })
  }
}

async function startVshudManagedIdleExit(
  input: VshudIdleExitRuntimePorts & {
    config: VshudManagedIdleExitConfig
    userDataPath: string
    version: string
  }
): Promise<void> {
  const { getLocalPtyProvider } = await import('../../../ipc/pty/provider/registry')
  const { getCurrentDaemonPid, getDaemonEndpointFacts, isDaemonTerminalAdmissionClosed } =
    await import('../../../daemon/providers/lifecycle/daemon-provider-state')
  const { countLiveVshudDaemonSessions, retireVshudDaemonIfIdle } =
    await import('../../daemon/vshud-daemon-retirement')
  const idleRecord = createIdleStopRecordOwnership(input.userDataPath)
  const hasChatProviders = (): boolean =>
    getStructuredAgentSessionHost()?.hasLoadedProviders() ?? false
  const ports: VshudManagedIdleExitPorts = {
    readClientActivity: () => input.rpc.readClientActivity(),
    listTerminals: () => getLocalPtyProvider().listProcesses(),
    countDaemonSessions: countLiveVshudDaemonSessions,
    hasDaemon: () => getDaemonEndpointFacts() !== null,
    agentStates: input.agentStates,
    hasChatProviders,
    hasStagedMigration: input.hasStagedMigration,
    automationsBusy: input.automationsBusy,
    emulatorsBusy: input.emulatorsBusy,
    activationFenceExists
  }
  // Client/terminal evidence is already checked; recheck other work exit would destroy.
  const nonTerminalWorkProbes = createVshudIdleProbes(input.config, ports).filter(
    (probe) => probe.name !== 'clients' && probe.name !== 'terminals'
  )
  const hasNonTerminalWork = async (): Promise<boolean> => {
    for (const probe of nonTerminalWorkProbes) {
      if (
        (await Promise.resolve()
          .then(probe.read)
          .catch(() => 'unverifiable')) !== 'idle'
      ) {
        return true
      }
    }
    return false
  }
  const dispose = installVshudManagedIdleExit({
    config: input.config,
    ports,
    stop: async (evidence) => {
      // Replacement must target only the daemon incarnation that agreed to retire.
      const retiringPid = getCurrentDaemonPid()
      const outcome = await stopForIdle(input, evidence, retireVshudDaemonIfIdle)
      // Clients/providers can return while the retirement reply is pending.
      const activity = input.rpc.readClientActivity()
      if (
        hasChatProviders() ||
        activity.openConnections > 0 ||
        activity.requestsInFlight > 0 ||
        activity.lastRequestAt > evidence.quietSince
      ) {
        discardVshudIdleStopRecord(input.userDataPath)
        const daemon = await recoverDaemonAfterCancelledIdleStop(outcome, {
          admissionClosed: isDaemonTerminalAdmissionClosed,
          retireAgain: () => retireVshudDaemonIfIdle(),
          replaceDaemon: async () => {
            if (retiringPid === null) {
              throw new Error('the retiring daemon never identified itself')
            }
            const { restartDaemon } =
              await import('../../../daemon/providers/lifecycle/daemon-provider-restart')
            await restartDaemon({ expectedDaemonPid: retiringPid, endpointMayBeGone: true })
          }
        })
        if (daemon === 'serving' || (await hasNonTerminalWork())) {
          return false
        }
        idleRecord.requestShutdown(requestIdleShutdown)
        return true
      }
      if (idleStopMayReleaseWslHolder(process.env, outcome)) {
        try {
          requestVshudWslHolderRelease(input.userDataPath)
        } catch (error) {
          console.error('[vshud] could not release the WSL distro holder:', error)
        }
      }
      idleRecord.requestShutdown(requestIdleShutdown)
      return true
    }
  })
  input.registerCleanup(() => {
    dispose()
    idleRecord.onShutdown()
  })
}

/** Discard failed, overdue and externally superseded idle stops, including cleanup before request completion. */
export function createIdleStopRecordOwnership(userDataPath: string): {
  requestShutdown(request: VshudShutdownTrigger | null): void
  onShutdown(): void
} {
  let idleOwnsStop = false
  // The holder release rides on the idle stop: a stop that is not idle must not end the distro.
  const discard = (): void => {
    discardVshudIdleStopRecord(userDataPath)
    withdrawVshudWslHolderRelease(userDataPath)
  }
  return {
    requestShutdown: (request) => {
      // Cleanup may run before the trigger returns, so establish ownership first.
      idleOwnsStop = true
      if (request?.('idle', discard) !== true) {
        idleOwnsStop = false
        discard()
      }
    },
    onShutdown: () => {
      if (!idleOwnsStop) {
        discard()
      }
    }
  }
}

async function stopForIdle(
  input: { userDataPath: string; version: string },
  evidence: VshudIdleExitEvidence,
  retireDaemon: () => Promise<VshudDaemonRetirement>
): Promise<VshudDaemonRetirement> {
  console.error(`[vshud] stopping: no client, terminal or job for ${evidence.timeoutMs}ms`)
  try {
    writeVshudIdleStopRecord(input.userDataPath, evidence, input.version)
  } catch (error) {
    console.error('[vshud] could not record the idle stop:', error)
  }
  // Only the daemon’s atomic empty census can authorize retirement.
  const outcome = await retireDaemon().catch((error: unknown): VshudDaemonRetirement => ({
    retirement: 'unverifiable',
    liveSessions: null,
    reason: String(error)
  }))
  console.error(
    `[vshud] terminal daemon on idle stop: ${outcome.retirement}${outcome.reason ? ` (${outcome.reason})` : ''}`
  )
  return outcome
}
