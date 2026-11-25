import type { VshuRuntimeService } from '../../runtime/vshu-runtime'
import type { WorkspaceCleanupRunner } from './workspace-cleanup-runner'

// Keyed by runtime: desktop main and vshud each own one runner for their own repos.
const runners = new WeakMap<VshuRuntimeService, WorkspaceCleanupRunner>()

export function setWorkspaceCleanupRunner(
  runtime: VshuRuntimeService,
  runner: WorkspaceCleanupRunner
): void {
  runners.set(runtime, runner)
}

export function getWorkspaceCleanupRunner(
  runtime: VshuRuntimeService
): WorkspaceCleanupRunner | undefined {
  return runners.get(runtime)
}

export function requireWorkspaceCleanupRunner(runtime: VshuRuntimeService): WorkspaceCleanupRunner {
  const runner = runners.get(runtime)
  if (!runner) {
    throw new Error('Workspace cleanup is not running on this host.')
  }
  return runner
}
