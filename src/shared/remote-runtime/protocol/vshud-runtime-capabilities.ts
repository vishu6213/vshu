// Older hosts lack terminalCensus; absent capability means unverifiable, never zero terminals.
export const VSHUD_TERMINAL_CENSUS_RUNTIME_CAPABILITY = 'vshud.terminal-census.v1' as const

// Absent capability refuses migration operations instead of calling missing methods on older hosts.
export const VSHUD_MIGRATION_CATALOG_RUNTIME_CAPABILITY = 'vshud.migration-catalog.v1' as const

// Abort by reference releases fences whose manifest cannot fit a request (before #30836). Older hosts lack this method.
export const VSHUD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY =
  'vshud.migration-catalog-abort-by-reference.v1' as const

// Gate each non-SSH source kind: older destinations strip source.kind and could misread WSL as SSH.
// Advertise local-wsl only once the destination parses that discriminator.
export const VSHUD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY =
  'vshud.migration-source.local-wsl.v1' as const

// The blob channel also requires each installed kind’s vshud.migration-blob.<kind>.v1 capability.
export const VSHUD_MIGRATION_BLOB_CHANNEL_RUNTIME_CAPABILITY = 'vshud.migration-blob.v1' as const

// Push desktop-owned host accounts (WSL) only to hosts supporting accounts.setHostLaunchEnv.
export const HOST_ACCOUNT_LAUNCH_ENV_RUNTIME_CAPABILITY = 'accounts.host-launch-env.v1' as const

// Older vshuds reject --reclaim-stale-lock; without this capability offer manual instructions.
export const VSHUD_STALE_LOCK_RECLAIM_RUNTIME_CAPABILITY = 'vshud.stale-lock-reclaim.v1' as const

// A WSL host's Remove asks host.peerDesktops before ending a server other desktops may share.
export const VSHUD_PEER_DESKTOPS_RUNTIME_CAPABILITY = 'vshud.peer-desktops.v1' as const

export const VSHUD_RUNTIME_CAPABILITIES = [
  VSHUD_STALE_LOCK_RECLAIM_RUNTIME_CAPABILITY,
  VSHUD_TERMINAL_CENSUS_RUNTIME_CAPABILITY,
  VSHUD_MIGRATION_CATALOG_RUNTIME_CAPABILITY,
  VSHUD_MIGRATION_CATALOG_ABORT_BY_REFERENCE_RUNTIME_CAPABILITY,
  HOST_ACCOUNT_LAUNCH_ENV_RUNTIME_CAPABILITY,
  VSHUD_PEER_DESKTOPS_RUNTIME_CAPABILITY
] as const
