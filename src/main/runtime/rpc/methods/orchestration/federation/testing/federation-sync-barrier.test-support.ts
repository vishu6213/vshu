import type { VshuRuntimeService } from '../../../../../vshu-runtime'
import type { OrchestrationDb } from '../../../../../orchestration/db/orchestration-db'

// Await the next relay round: the current coalesced tick may have read peers before the latest mutation.
export async function syncFederationBarrier(
  runtime: VshuRuntimeService,
  db: OrchestrationDb
): Promise<void> {
  const dispatches = db.listActiveFederatedDispatches()
  await Promise.allSettled(
    dispatches.map((dispatch) =>
      runtime.syncOrchestrationFederatedDispatchAfterCurrent(dispatch.dispatch_id)
    )
  )
}
