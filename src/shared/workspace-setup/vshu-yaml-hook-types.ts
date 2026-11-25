export type SetupRunPolicy = 'ask' | 'run-by-default' | 'skip-by-default'
export type SetupAgentStartupPolicy = 'start-immediately' | 'wait-for-setup'
export type HookCommandSourcePolicy = 'shared-only' | 'local-only' | 'run-both'

export type VshuHooks = {
  scripts: {
    setup?: string // Runs after worktree is created
    archive?: string // Runs before worktree is archived
  }
  setupAgentStartupPolicy?: SetupAgentStartupPolicy
  issueCommand?: string // Shared default command for linked GitHub issues
  defaultTabs?: VshuDefaultTabTemplate[] // Terminal tabs to create once for a new worktree
  environmentRecipes?: VshuVmRecipe[] // Project-scoped per-workspace environment recipes
  environmentRecipeDiagnostics?: VshuVmRecipeDiagnostic[] // Non-fatal validation issues from environmentRecipes
  worktree?: VshuWorktreeDefaults // Project-scoped defaults applied when a worktree is created
}

export type VshuWorktreeDefaults = {
  // Share large rebuildable directories such as node_modules across worktrees instead of copying installs.
  sharedDirectories?: string[]
}

export type VshuDefaultTabTemplate = {
  title?: string
  color?: string
  command?: string
}

export type EphemeralVmCheckoutMode = 'vshu-worktree' | 'provisioned-root'

export type VshuVmRecipe = {
  id: string
  name: string
  create: string
  checkoutMode?: EphemeralVmCheckoutMode
  description?: string
  suspend?: string
  resume?: string
  destroy?: string
  destroyDisabled?: boolean
  // Per-mode wall-clock limits; vshu.yaml accepts one number for every mode or a per-mode map.
  timeoutSeconds?: VshuVmRecipeTimeoutSeconds
  // Opt-in allowlist of Vshu's environment variables the scripts receive (plus a safe base set).
  // Omitted means scripts inherit the full environment.
  passEnv?: string[]
}

export type VshuVmRecipeLifecycleMode = 'create' | 'suspend' | 'resume' | 'destroy'

export type VshuVmRecipeTimeoutSeconds = Partial<Record<VshuVmRecipeLifecycleMode, number>>

export type VshuVmRecipeDiagnostic = {
  index: number
  field?: string
  message: string
}

export type RepoHookSettings = {
  // Retain the old hook-UI mode so persisted state reads without migration.
  mode: 'auto' | 'override'
  setupRunPolicy?: SetupRunPolicy
  setupAgentStartupPolicy?: SetupAgentStartupPolicy
  commandSourcePolicy?: HookCommandSourcePolicy
  scripts: {
    setup: string
    archive: string
  }
}

export type PersistedTrustedVshuHookEntry = {
  contentHash: string
  approvedAt: number
  /** Earlier approvals, newest first, so switching between branches' scripts doesn't re-prompt. */
  previousContentHashes?: string[]
}

export type PersistedTrustedVshuHookRepo = {
  all?: {
    approvedAt: number
  }
  setup?: PersistedTrustedVshuHookEntry
  archive?: PersistedTrustedVshuHookEntry
  issueCommand?: PersistedTrustedVshuHookEntry
  vmRecipe?: PersistedTrustedVshuHookEntry
}

export type PersistedTrustedVshuHooks = Record<string, PersistedTrustedVshuHookRepo>
