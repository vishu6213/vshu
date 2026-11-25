/**
 * Writes the `vshudRetained` mark on local project rows (mover design, section 4.5). Only this
 * machine's rows: the WSL host's own row carries the same id and is never marked.
 */
import type { FolderWorkspace } from '../../../../shared/folder-workspaces/folder-workspace-types'
import {
  sameVshudRetainedMarker,
  type VshudRetainedMarker
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-retained-marker'
import type { PersistedState } from '../../../../shared/vshu-profiles/persisted-state-types'
import type { Repo } from '../../../../shared/repository/repo-types'
import { isLocalWslMoveRow } from '../quiescence/wsl-move-scope-guard'

/** `marker: null` removes the mark. */
export type WslMoveRetainedMark = {
  kind: 'repo' | 'folder'
  id: string
  marker: VshudRetainedMarker | null
}

/** Mutates the rows in place; returns how many changed so the caller saves only when needed. */
export function applyWslMoveRetainedMarks(
  state: Pick<PersistedState, 'repos' | 'folderWorkspaces'>,
  marks: readonly WslMoveRetainedMark[]
): number {
  let changed = 0
  for (const mark of marks) {
    const rows: readonly (Repo | FolderWorkspace)[] =
      mark.kind === 'repo' ? state.repos : (state.folderWorkspaces ?? [])
    const row = rows.find((entry) => entry.id === mark.id && isLocalWslMoveRow(entry))
    const next = mark.marker ?? undefined
    if (!row || sameVshudRetainedMarker(row.vshudRetained, next)) {
      continue
    }
    if (next) {
      row.vshudRetained = { ...next }
    } else {
      delete row.vshudRetained
    }
    changed++
  }
  return changed
}
