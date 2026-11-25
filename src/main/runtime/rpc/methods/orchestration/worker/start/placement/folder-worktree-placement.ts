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
