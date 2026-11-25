import { useEffect } from 'react'
import type { GitUpstreamStatus } from '../../../../../../shared/git/status/git-status-types'
import type { SourceControlWorktreeOperationState } from '../panel/use-worktree-operation-state'
import type { VshuRebaseMarker } from '../panel/worktree-operation-store'
import { vshuRebaseMarkerIsRetired, vshuRebaseMarkerMatches } from './vshu-rebase-marker'

/** After Vshu's own rebase, hide Pull/Sync/FF/Push while the branch still diverges from the same tip. */
export function useVshuRebaseMarker({
  branchName,
  operationStore,
  vshuRebase,
  remoteStatus
}: {
  branchName: string
  operationStore: SourceControlWorktreeOperationState['operationStore']
  vshuRebase: VshuRebaseMarker | null
  remoteStatus: GitUpstreamStatus | undefined
}): boolean {
  const applies =
    vshuRebase !== null && vshuRebaseMarkerMatches(vshuRebase, branchName, remoteStatus)
  const retired =
    vshuRebase !== null && vshuRebaseMarkerIsRetired(vshuRebase, branchName, remoteStatus)
  // Readings right after the rebase are still pre-rebase ones; only a seen match arms mismatch retirement.
  const promote = applies && vshuRebase?.state === 'done'
  const matchedBehind = remoteStatus?.behind
  useEffect(() => {
    const current = operationStore.getState().vshuRebase
    if (retired) {
      operationStore.setState({ vshuRebase: null })
    } else if (promote && current) {
      operationStore.setState({
        vshuRebase: { ...current, state: 'active', behind: matchedBehind }
      })
    }
  }, [matchedBehind, operationStore, promote, retired])
  return applies && !retired
}
