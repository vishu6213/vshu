import type { FolderWorkspace } from '../folder-workspaces/folder-workspace-types'
import type { Repo } from '../repository/repo-types'
import type { SavedPortForward, SshRemotePtyLease } from '../remote-runtime/ssh/ssh-types'

export const VSHUD_MIGRATION_DEPENDENCY_KINDS = [
  'saved-port-forward',
  'terminal-lease',
  'terminal-recovery',
  'workspace-session',
  'worktree-metadata',
  'worktree-lineage',
  'workspace-lineage',
  'sparse-preset',
  'retired-worktree-name',
  'automation',
  'automation-run',
  'mobile-tab-selection',
  'ui-routing'
] as const

export type VshudMigrationDependencyKind = (typeof VSHUD_MIGRATION_DEPENDENCY_KINDS)[number]

export type VshudMigrationDependency = {
  kind: VshudMigrationDependencyKind
  count: number
  /** A bounded sample of what holds the reference, so the user can find and clear it. */
  names?: string[]
}

export type VshudMigrationRepository = Pick<Repo, 'id' | 'path' | 'displayName' | 'kind'>
export type VshudMigrationFolderWorkspace = Pick<FolderWorkspace, 'id' | 'name' | 'folderPath'>
export type VshudMigrationTerminalLease = Pick<
  SshRemotePtyLease,
  'ptyId' | 'worktreeId' | 'tabId' | 'leafId' | 'state' | 'updatedAt'
>

export type VshudMigrationBlocker =
  | {
      code: 'vshud_migration_target_not_found'
      category: 'registration'
    }
  | {
      code: 'vshud_migration_target_owned'
      category: 'exclusive-ownership'
      holder:
        | { kind: 'runtime'; runtimeId: string }
        | { kind: 'managed-server'; environmentId: string }
    }
  | {
      /** Owned by the asking environment, but no durable record of why. */
      code: 'vshud_migration_owner_unrecorded'
      category: 'exclusive-ownership'
    }
  | {
      code: 'vshud_migration_direct_ssh_repositories'
      category: 'drainable-static-state'
      repositories: VshudMigrationRepository[]
    }
  | {
      code: 'vshud_migration_direct_ssh_folder_workspaces'
      category: 'drainable-static-state'
      folderWorkspaces: VshudMigrationFolderWorkspace[]
    }
  | {
      code: 'vshud_migration_direct_ssh_terminal_leases'
      category: 'live-or-unverifiable'
      terminalLeases: VshudMigrationTerminalLease[]
    }
  | {
      code: 'vshud_migration_saved_port_forwards'
      category: 'client-owned-state'
      portForwards: SavedPortForward[]
    }
  | {
      code: 'vshud_migration_dependent_state'
      category: 'client-owned-state'
      dependencies: VshudMigrationDependency[]
    }
  | {
      code: 'vshud_migration_dependency_unverifiable'
      category: 'live-or-unverifiable'
      sources: VshudMigrationDependencyKind[]
    }

export type VshudMigrationPreflight = {
  targetId: string
  targetLabel: string | null
  claimable: boolean
  blockers: VshudMigrationBlocker[]
}
