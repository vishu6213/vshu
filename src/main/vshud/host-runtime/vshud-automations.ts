import type { Store } from '../../persistence/loading-store/store'
import type { VshuRuntimeService } from '../../runtime/vshu-runtime'
import { createRuntimeAutomationService } from '../../automations/runtime-automation-service'
import type { VshudUsageClients } from './vshud-usage-service'
import { isFinalAutomationRunStatus } from '../../../shared/automations/history/automation-run'

type AutomationStore = Pick<Store, 'listAutomations' | 'listAutomationRuns'>

let stopScheduler: (() => void) | null = null

export function startVshudAutomations(
  runtime: VshuRuntimeService,
  store: Store,
  usage: VshudUsageClients,
  registerCleanup: (cleanup: () => void) => void
): void {
  const service = createRuntimeAutomationService({
    store,
    runtime,
    ...usage,
    allowRemoteHostScheduling: true
  })
  stopScheduler = () => service.stop()
  // Stop before final profile flush so runs cannot persist afterward.
  registerCleanup(() => service.stop())
  service.start()
}

export function stopVshudAutomationScheduler(): void {
  stopScheduler?.()
}

/** Pending schedules/runs must keep the host alive. */
export function vshudAutomationsKeepHostBusy(store: AutomationStore): boolean {
  return (
    store.listAutomations().some((automation) => automation.enabled) ||
    store.listAutomationRuns().some((run) => !isFinalAutomationRunStatus(run.status))
  )
}
