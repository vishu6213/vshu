// Live terminals block idle exit; ordinary shutdown disconnects without killing their daemon.
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { RELAY_INSTALL_LOCK_NAME } from '../../../../shared/remote-runtime/relay/relay-install-lock-name'
import { hasErrorCode } from '../../../daemon/endpoint/identity/daemon-process-inspection'
import type { RuntimeRpcClientActivity } from '../../../runtime/rpc/server/runtime-rpc'
import { VSHUD_MANAGED_ACTIVATION_ROOT_ENV } from '../../../../shared/remote-runtime/serve-supervisor/vshud-managed-launch-env'
import {
  VSHUD_IDLE_EXIT_TIMEOUT_MS,
  readVshudE2EIdleTimeoutMs,
  readVshudIdleTimeoutMs
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-idle-exit'
import {
  VshudIdleExitMonitor,
  type VshudIdleExitEvidence,
  type VshudIdleProbe,
  type VshudIdleVerdict
} from './vshud-idle-exit-monitor'

export type VshudManagedIdleExitConfig = { timeoutMs: number; activationRoot: string }

/** User-started/paired servers never idle out; only client-managed launches opt in. */
export function resolveVshudManagedIdleExit(
  env: NodeJS.ProcessEnv
): VshudManagedIdleExitConfig | null {
  const activationRoot = env[VSHUD_MANAGED_ACTIVATION_ROOT_ENV]
  if (!activationRoot) {
    return null
  }
  return {
    timeoutMs:
      readVshudE2EIdleTimeoutMs(env) ?? readVshudIdleTimeoutMs(env) ?? VSHUD_IDLE_EXIT_TIMEOUT_MS,
    activationRoot
  }
}

export type VshudManagedIdleExitPorts = {
  readClientActivity: () => RuntimeRpcClientActivity
  listTerminals: () => Promise<readonly unknown[]>
  /** Null means some daemon generation did not answer. */
  countDaemonSessions: () => Promise<number | null>
  hasDaemon: () => boolean
  agentStates: () => readonly { state: string }[]
  hasChatProviders: () => boolean
  hasStagedMigration: () => boolean
  /** Enabled schedules or unsettled runs would be lost on exit. */
  automationsBusy: () => boolean
  /** Exit would shut down the emulators Vshu started for a workspace. */
  emulatorsBusy: () => Promise<boolean>
  activationFenceExists: (root: string) => Promise<boolean>
}

export function createVshudIdleProbes(
  config: VshudManagedIdleExitConfig,
  ports: VshudManagedIdleExitPorts
): VshudIdleProbe[] {
  const verdict = (busy: boolean): VshudIdleVerdict => (busy ? 'busy' : 'idle')
  return [
    {
      name: 'clients',
      read: () => {
        const activity = ports.readClientActivity()
        return verdict(activity.openConnections > 0 || activity.requestsInFlight > 0)
      }
    },
    {
      name: 'terminals',
      read: async () => {
        if ((await ports.listTerminals()).length > 0) {
          return 'busy'
        }
        // Daemons may retain sessions absent from this process’s provider inventory.
        if (!ports.hasDaemon()) {
          return 'idle'
        }
        const live = await ports.countDaemonSessions()
        return live === null ? 'unverifiable' : verdict(live > 0)
      }
    },
    {
      name: 'agents',
      read: () => verdict(ports.agentStates().some((entry) => entry.state === 'working'))
    },
    { name: 'chat-providers', read: () => verdict(ports.hasChatProviders()) },
    { name: 'migration', read: () => verdict(ports.hasStagedMigration()) },
    { name: 'automations', read: () => verdict(ports.automationsBusy()) },
    { name: 'emulators', read: async () => verdict(await ports.emulatorsBusy()) },
    {
      name: 'activation',
      read: async () => verdict(await ports.activationFenceExists(config.activationRoot))
    }
  ]
}

/** A bare activation root may be interrupted acquisition; only its lock proves a held fence. */
export async function activationFenceExists(root: string): Promise<boolean> {
  try {
    await stat(join(root, RELAY_INSTALL_LOCK_NAME))
    return true
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return false
    }
    throw error
  }
}

export function installVshudManagedIdleExit(input: {
  config: VshudManagedIdleExitConfig
  ports: VshudManagedIdleExitPorts
  stop: (evidence: VshudIdleExitEvidence) => void | boolean | Promise<void | boolean>
}): () => void {
  const monitor = new VshudIdleExitMonitor({
    timeoutMs: input.config.timeoutMs,
    probes: createVshudIdleProbes(input.config, input.ports),
    lastClientActivityAt: () => input.ports.readClientActivity().lastRequestAt,
    onIdle: input.stop
  })
  monitor.start()
  return () => monitor.stop()
}
