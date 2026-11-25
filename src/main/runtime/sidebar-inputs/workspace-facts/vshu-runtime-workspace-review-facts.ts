import { VshuRuntimeWithWorkspaceActivityFacts } from './vshu-runtime-workspace-activity-facts'
import {
  buildWorkspaceReviewFacts,
  type WorkspaceReviewFactsSnapshot
} from '../../../../shared/sidebar-list/feed-facts/workspace-review-facts'

/** Read host-persisted PR facts on demand; windows save cache updates within a second, while vshud uses its existing profile. */
export abstract class VshuRuntimeWithWorkspaceReviewFacts extends VshuRuntimeWithWorkspaceActivityFacts {
  async getWorkspaceReviewFacts(): Promise<WorkspaceReviewFactsSnapshot> {
    if (!this.store) {
      return { facts: {} }
    }
    const { worktrees } = await this.listResolvedWorktreeSnapshot()
    return {
      facts: buildWorkspaceReviewFacts(
        worktrees,
        this.store.getRepos(),
        this.store.getGitHubCache().pr
      )
    }
  }
}
