import { isFolderRepo } from '../../../../../../../../shared/repository/repo-kind'
import type { VshuRuntimeService } from '../../../../../../vshu-runtime'
import { OrchestrationError } from '../../../../../../orchestration/orchestration-error'

export async function assertOrchestrationWorktreeCreationSupported(args: {
  runtime: VshuRuntimeService
  repoSelector: string
  existingPlacement: string
}): Promise<void> {
  if (!isFolderRepo(await args.runtime.showRepo(args.repoSelector))) {
    return
  }
  throw new OrchestrationError(
    'invalid_argument',
    `Folder projects cannot create orchestration worktrees; use ${args.existingPlacement}.`
  )
}

/** The existing workspace a worker reuses, or none once a new worktree's repo can host one. */
export async function resolveExistingWorkerWorkspace(
  runtime: VshuRuntimeService,
  creationTarget: { repoSelector: string } | undefined,
  existingWorktree: string
): Promise<Awaited<ReturnType<VshuRuntimeService['showManagedTerminalWorkspace']>> | undefined> {
  if (!creationTarget) {
    return runtime.showManagedTerminalWorkspace(existingWorktree)
  }
  await assertOrchestrationWorktreeCreationSupported({
    runtime,
    repoSelector: creationTarget.repoSelector,
    existingPlacement: 'current or an exact existing folder workspace'
  })
  return undefined
}
