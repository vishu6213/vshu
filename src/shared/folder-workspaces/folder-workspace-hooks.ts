import type { VshuHooks } from '../workspace-setup/vshu-yaml-hook-types'
import type { Repo } from '../repository/repo-types'
import { isFolderRepo } from '../repository/repo-kind'

/** Folder workspaces share one directory, so vshu.yaml default tabs would start again for every one. */
export function scopeHooksToRepoKind(
  repo: Pick<Repo, 'kind'>,
  hooks: VshuHooks | null
): VshuHooks | null {
  if (!hooks || !isFolderRepo(repo) || !hooks.defaultTabs) {
    return hooks
  }
  return { ...hooks, defaultTabs: undefined }
}
