import type { VshuRuntimeService } from '../../runtime/vshu-runtime'
import type { RuntimeStore } from '../../runtime/construction/runtime-store-contract'
import { WorkspaceCleanupRunner } from './workspace-cleanup-runner'
import { setWorkspaceCleanupRunner } from './workspace-cleanup-runner-registry'

/** Starts the runner for the repos this process owns: desktop main for local/WSL, each vshud for its own. */
export function startWorkspaceCleanupRunner(
  runtime: VshuRuntimeService,
  store: RuntimeStore
): WorkspaceCleanupRunner | null {
  const historyDirectory = store.getProfileStorageDirectory?.()
  if (!historyDirectory) {
    return null
  }
  const runner = new WorkspaceCleanupRunner({ runtime, store, historyDirectory })
  setWorkspaceCleanupRunner(runtime, runner)
  runner.start()
  return runner
}
