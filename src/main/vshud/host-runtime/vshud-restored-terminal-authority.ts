import { VSHU_LAYOUT_OWNER_IS_MAIN } from '../../../shared/workspace-layout/layout-owner-switch'
import type { VshuRuntimeService } from '../../runtime/vshu-runtime'
import type { VshudFeatureReadiness } from '../../runtime/rpc/startup/vshud-readiness'
import { placeUnshownLiveTerminalsBestEffort } from '../../runtime/terminal/adoption/unshown-live-terminal-placement'
import type { createVshudStartupTiming } from '../diagnostics/vshud-startup-timing'

/** Restored orchestration authority, the legacy terminal reconcile and unshown placement, in order. */
export async function restoreVshudTerminalAuthority(
  runtime: VshuRuntimeService,
  timed: ReturnType<typeof createVshudStartupTiming>['time'],
  readiness: VshudFeatureReadiness
): Promise<void> {
  await timed('orchestration', () => runtime.refreshRestoredOrchestrationAuthority())
  readiness.open('orchestration')
  // Terminal inventory stays on the critical path: no latch, every client needs it at connect.
  await timed('reconcile-terminals', () => runtime.reconcileLegacyWorkerTerminals())
  // Off the critical path: it waits for chat continuations and reports what they left.
  void runtime.reportWorkerStopsAcrossRestartOnce()
  if (VSHU_LAYOUT_OWNER_IS_MAIN) {
    await placeUnshownLiveTerminalsBestEffort(runtime)
  }
  readiness.open('unshownPlacement')
}
