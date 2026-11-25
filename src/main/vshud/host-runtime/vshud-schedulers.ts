import type { Store } from '../../persistence/loading-store/store'
import type { VshuRuntimeService } from '../../runtime/vshu-runtime'
import { startWorkspaceCleanupRunner } from '../../workspaces/cleanup/workspace-cleanup-runner-startup'
import { getWorkspaceCleanupRunner } from '../../workspaces/cleanup/workspace-cleanup-runner-registry'
import { vshudAutomationsKeepHostBusy, startVshudAutomations } from './vshud-automations'
import type { VshudUsageClients } from './vshud-usage-service'

/** The host's own background jobs: automation schedules and workspace cleanup rules. */
export function startVshudSchedulers(
  runtime: VshuRuntimeService,
  store: Store,
  usage: VshudUsageClients,
  registerCleanup: (cleanup: () => void) => void
): void {
  startVshudAutomations(runtime, store, usage, registerCleanup)
  const cleanupRunner = startWorkspaceCleanupRunner(runtime, store)
  registerCleanup(() => cleanupRunner?.stop())
}

/** A cleanup run mid-removal must finish before idle exit, like a pending automation run. */
export function vshudSchedulersKeepHostBusy(runtime: VshuRuntimeService, store: Store): boolean {
  return (
    vshudAutomationsKeepHostBusy(store) || getWorkspaceCleanupRunner(runtime)?.isRunning() === true
  )
}
