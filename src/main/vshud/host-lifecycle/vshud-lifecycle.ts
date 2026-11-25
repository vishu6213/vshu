import { closeEnvironmentStore } from '../../../shared/remote-runtime/host-store/runtime-environment-store-worker-client'
import { worktreeRemovalLifetime } from '../../workspaces/removal/worktree-removal-lifetime'
import { setRuntimeBrowserCommandsFactory } from '../../runtime/browser/installation/runtime-browser-commands-factory'
import { markHostShuttingDown } from '../../startup/quit/host-shutdown-state'
import { setDesktopBrowserBridgeHostEnabled } from '../../runtime/desktop-browser-bridge/desktop-browser-bridge-registry'
import { VSHUD_MANAGED_ACTIVATION_ROOT_ENV } from '../../../shared/remote-runtime/serve-supervisor/vshud-managed-launch-env'
import { startVshudBrowserProvider } from '../browser-providers/vshud-browser-startup'
import {
  BackendServiceLifetime,
  type BackendServiceCleanup
} from '../../backend/service-composition'
import type { VshudManagedStopInstance } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'
import { acquireVshudInstanceLock } from '../instance-lock/vshud-instance-lock'
import {
  markVshudRunFailed,
  vshudRunFailed,
  recordVshudPreviousUnexpectedExit
} from './vshud-unexpected-exit'
import { VSHUD_BUNDLED_LAUNCHER_ENV } from '../runtime-launch/vshud-bundled-runtime'
import { resolveVshudExitCode } from '../serve-startup/vshud-exit-code'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from '../../../shared/app-lifecycle/launch/single-instance-exit-code'
import { recordAgentSessionRuntimeEnd } from '../../runtime/agent-session/records/agent-session-runtime-end-record'
import type { collectLocalSavedStructuredAgentSessionIds } from '../../runtime/agent-session/lifecycle/saved-structured-agent-session-restoration'
import type { AgentSessionRecordStoreStartupOpen } from '../../runtime/agent-session/records/local-agent-session-record-store-startup-open'
import { VSHUD_SHUTDOWN_DEADLINE_MS } from './managed-stop/vshud-stop-deadlines'
import { holdVshudTerminalAdmissionUntilExit } from './managed-stop/vshud-stop-terminal-admission'
import {
  acquireProfileStateRuntimeAdmission,
  type ProfileStateRuntimeAdmission
} from '../../persistence/profile-state/access/profile-state-access'

const bundledLauncherChannel = process.env[VSHUD_BUNDLED_LAUNCHER_ENV] === '1'
delete process.env[VSHUD_BUNDLED_LAUNCHER_ENV]

function createIdempotentVshudCleanup(cleanup: () => Promise<void>): () => Promise<void> {
  let completion: Promise<void> | null = null
  return () => {
    completion ??= Promise.resolve().then(cleanup)
    return completion
  }
}

/** Return whether this caller owns the stop; fatal faults supply a nonzero completed-stop code. */
export type VshudShutdownTrigger = (
  reason: string,
  onFailed?: () => void,
  stoppedExitCode?: number
) => boolean

let installedShutdown: VshudShutdownTrigger | null = null

/** Deduplicate launcher/child signals into one bounded stop; onFailed retracts clean-stop records. */
export function installVshudShutdownSignals(
  stop: () => Promise<void>,
  deadlineMs = VSHUD_SHUTDOWN_DEADLINE_MS
): VshudShutdownTrigger {
  let stopping = false
  let exitCode = 0
  let failed = false
  let retractClean: (() => void) | undefined
  const markFailed = (): void => {
    if (!failed) {
      failed = true
      retractClean?.()
    }
  }
  const shutdown: VshudShutdownTrigger = (signal, onFailed, stoppedExitCode = 0) => {
    // Yielding a lost lock is not a crash; the successor owns the lock now.
    if (stoppedExitCode !== 0 && stoppedExitCode !== SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE) {
      markVshudRunFailed()
    }
    if (stopping) {
      // Fatal faults must escalate an in-progress clean stop to failure.
      if (stoppedExitCode !== 0 && exitCode === 0) {
        exitCode = stoppedExitCode
        onFailed?.()
        markFailed()
      }
      return false
    }
    stopping = true
    markHostShuttingDown()
    void worktreeRemovalLifetime.close().catch(() => {})
    holdVshudTerminalAdmissionUntilExit()
    exitCode = stoppedExitCode
    retractClean = onFailed
    setTimeout(() => {
      console.error(`vshud: shutdown after ${signal} exceeded ${deadlineMs}ms — exiting`)
      markFailed()
      process.exit(1)
    }, deadlineMs)
    stop()
      .then(() => process.exit(exitCode))
      .catch((error) => {
        console.error(`vshud: shutdown after ${signal} failed:`, error)
        markFailed()
        process.exit(resolveVshudExitCode(error))
      })
    return true
  }
  installedShutdown = shutdown
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  // Survive terminal hangups; INT/TERM request graceful shutdown.
  if (process.platform !== 'win32') {
    process.on('SIGHUP', () => {})
  }
  if (bundledLauncherChannel && typeof process.send === 'function') {
    process.once('disconnect', () => shutdown('launcher disconnect'))
    if (!process.connected) {
      shutdown('launcher disconnect')
    }
  }
  return shutdown
}

/** Starts the saved-chat writer from the profile's tab snapshot; `serving` releases maintenance. */
export async function startVshudAgentSessionRecordStoreOpen(
  profileStore: Parameters<typeof collectLocalSavedStructuredAgentSessionIds>[0]
): Promise<{
  open: AgentSessionRecordStoreStartupOpen
  maintenanceAfter: Promise<void>
  serving: () => void
}> {
  const { startLocalAgentSessionRecordStoreOpen } =
    await import('../../runtime/agent-session/records/local-agent-session-record-store-startup-open')
  const { collectLocalSavedStructuredAgentSessionIds: collectIds } =
    await import('../../runtime/agent-session/lifecycle/saved-structured-agent-session-restoration')
  const serving = Promise.withResolvers<void>()
  return {
    open: startLocalAgentSessionRecordStoreOpen(collectIds(profileStore), serving.promise),
    maintenanceAfter: serving.promise,
    serving: () => serving.resolve()
  }
}

export async function stopVshudStructuredAgentSessions(): Promise<void> {
  const { stopStructuredAgentSessionRuntime } =
    await import('../../runtime/agent-session/installation/structured-agent-session-runtime')
  await stopStructuredAgentSessionRuntime({ trigger: 'quit' })
}

export async function startVshudWithLifecycle<T extends object>(
  start: (registerRuntimeCleanup: (cleanup: BackendServiceCleanup) => void) => Promise<T>,
  cleanupHost: (runtimeCleanupSucceeded: boolean) => Promise<void>,
  checkpoint: () => Promise<void> = async () => {}
): Promise<T & { stop(): Promise<void> }> {
  const runtime = new BackendServiceLifetime()
  const cleanup = createIdempotentVshudCleanup(async () => {
    // Stamp quit before awaiting teardown so dying chat agents read as restart rather than crash.
    recordAgentSessionRuntimeEnd('quit')
    // Startup failures reach cleanup without shutdown admission while RPC may already be serving.
    markHostShuttingDown()
    void worktreeRemovalLifetime.close().catch(() => {})
    let checkpointError: unknown
    const checkpointing = Promise.resolve()
      .then(checkpoint)
      .catch((error: unknown) => {
        checkpointError = error
      })
    let runtimeCleanupSucceeded = false
    try {
      await runtime.stop()
      await checkpointing
      if (checkpointError) {
        throw checkpointError
      }
      runtimeCleanupSucceeded = true
    } finally {
      await checkpointing
      try {
        await closeEnvironmentStore()
      } finally {
        await cleanupHost(runtimeCleanupSucceeded)
      }
    }
  })
  try {
    const handle = await start((nextCleanup) => runtime.add(nextCleanup))
    return { ...handle, stop: cleanup }
  } catch (error) {
    try {
      await cleanup()
    } catch (cleanupError) {
      // Preserve the startup fault while recording cleanup failures.
      console.error('[vshud] startup cleanup failed:', cleanupError)
    }
    throw error
  }
}

/** Keep profile admission/lock until all runtime writers stop. */
export async function startVshudWithHost<T extends object>(
  userDataPath: string,
  start: (registerCleanup: (cleanup: BackendServiceCleanup) => void) => Promise<T>,
  runQuitHandlers: () => void | Promise<void>,
  checkpoint: () => Promise<void> = async () => {}
): Promise<T & { stop(): Promise<void>; instance: VshudManagedStopInstance }> {
  const instanceLock = acquireVshudInstanceLock(userDataPath, {
    // Yield the data root to the process that took its lock; supervisors stand by on this code.
    onExclusivityLost: () => {
      console.error('[vshud] Stopping so only one runtime writes this data root.')
      installedShutdown?.(
        'instance lock lost',
        undefined,
        SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE
      )
    }
  })
  const previous = instanceLock.previousUnexpectedExit
  recordVshudPreviousUnexpectedExit(previous)
  if (previous) {
    console.error(
      `[vshud] the previous run (pid ${previous.pid}, ${previous.version}) exited without stopping cleanly`
    )
  }
  const { pid, startedAtMs, nonce } = instanceLock.record
  const instance = { pid, startedAtMs, nonce, lockPath: instanceLock.path }
  let admission: ProfileStateRuntimeAdmission | undefined
  let browserProvider: ReturnType<typeof startVshudBrowserProvider> | undefined
  return startVshudWithLifecycle(
    async (registerCleanup) => {
      admission = acquireProfileStateRuntimeAdmission(userDataPath)
      // Browser authorization UI must not block RPC readiness.
      browserProvider = startVshudBrowserProvider({ userDataPath })
      // Only managed hosts have opted-in desktop bridges; user-started hosts route to paired page hosts.
      setDesktopBrowserBridgeHostEnabled(Boolean(process.env[VSHUD_MANAGED_ACTIVATION_ROOT_ENV]))
      return { ...(await start(registerCleanup)), instance }
    },
    async (runtimeCleanupSucceeded) => {
      // Failed cleanup retains both ownership fences until process exit.
      const host = new BackendServiceLifetime(() => {
        if (runtimeCleanupSucceeded && !vshudRunFailed()) {
          instanceLock.release()
        }
      })
      host.add(({ failed }) => {
        if (runtimeCleanupSucceeded && !failed) {
          admission?.release()
        }
      })
      host.add(() => runQuitHandlers())
      host.add(() => setRuntimeBrowserCommandsFactory(null))
      host.add(() => setDesktopBrowserBridgeHostEnabled(false))
      host.add(() => browserProvider?.stop())
      await host.stop()
    },
    checkpoint
  )
}

export async function flushVshudProfileStoreForShutdown(
  store: { flushFinalOrThrowAsync(): Promise<void>; freezeWritesAsync(): Promise<void> },
  paneGrids?: { flushPaneGrids(): Promise<void> | null } | null
): Promise<void> {
  // A pane's grid still inside its write burst joins the final save.
  const flushing = paneGrids?.flushPaneGrids()
  if (flushing) {
    await flushing
  }
  try {
    await store.flushFinalOrThrowAsync()
  } finally {
    await store.freezeWritesAsync()
  }
}
