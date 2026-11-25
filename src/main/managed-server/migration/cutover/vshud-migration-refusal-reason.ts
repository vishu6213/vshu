import type {
  VshudMigrationBlocker,
  VshudMigrationDependencyKind
} from '../../../../shared/vshud-migration/vshud-migration-preflight'

const DEPENDENCY_WORDS: Record<VshudMigrationDependencyKind, string> = {
  'saved-port-forward': 'saved port forwards',
  'terminal-lease': 'terminals still running',
  'terminal-recovery': 'terminals waiting to reconnect',
  'workspace-session': 'saved tabs and panes',
  'worktree-metadata': 'saved workspace details',
  'worktree-lineage': 'workspace history',
  'workspace-lineage': 'workspace history',
  'sparse-preset': 'sparse checkout presets',
  'retired-worktree-name': 'retired workspace names',
  automation: 'automations',
  'automation-run': 'automation runs',
  'mobile-tab-selection': 'mobile tab selections',
  'ui-routing': 'sidebar settings'
}

function blockerWords(blocker: VshudMigrationBlocker): string[] {
  switch (blocker.code) {
    case 'vshud_migration_target_not_found':
      return ['the host is no longer saved']
    case 'vshud_migration_target_owned':
      return ['another server holds it']
    case 'vshud_migration_owner_unrecorded':
      return ['its server record is missing']
    case 'vshud_migration_direct_ssh_terminal_leases':
      return [
        `terminals still running (${blocker.terminalLeases.length}): close them, or end them on the host`
      ]
    case 'vshud_migration_dependent_state':
      return blocker.dependencies.map(({ kind, count, names }) =>
        names?.length
          ? `${DEPENDENCY_WORDS[kind]} (${names.join('; ')})`
          : `${DEPENDENCY_WORDS[kind]} (${count})`
      )
    case 'vshud_migration_dependency_unverifiable':
      return [
        `saved state Vshu could not read (${blocker.sources.map((kind) => DEPENDENCY_WORDS[kind]).join(', ')})`
      ]
    case 'vshud_migration_direct_ssh_repositories':
    case 'vshud_migration_direct_ssh_folder_workspaces':
    case 'vshud_migration_saved_port_forwards':
      // These move with the host or stay behind; they never refuse a conversion.
      return []
  }
}

export function vshudMigrationRefusalReason(blockers: readonly VshudMigrationBlocker[]): string {
  const words = [...new Set(blockers.flatMap(blockerWords))]
  return words.length > 0
    ? `This SSH host cannot move yet: ${words.join(', ')}.`
    : 'This SSH host cannot move yet.'
}
