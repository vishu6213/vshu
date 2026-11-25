import type { VshuCloudTeamPolicy } from './vshu-cloud-team-policy'

export type VshuCloudCapabilityFlags = Record<string, boolean>

export type VshuCloudCapabilities = {
  flags: VshuCloudCapabilityFlags
  refreshedAt: number
  teamPolicy?: VshuCloudTeamPolicy
  /** The web console's https origin, as auth advertises it (its ticket URLs land there). */
  consoleOrigin?: string
}
