import { wslDistroHolderKey } from '../discovery/wsl-distro-holder-record'

const WSL_VSHUD_ENVIRONMENT_ID_PREFIX = 'wsl:'

/** Every registered WSL host's environment id. */
export function defaultWslVshudEnvironmentId(distro: string): string {
  return `${WSL_VSHUD_ENVIRONMENT_ID_PREFIX}${wslDistroHolderKey(distro)}`
}

/** Synchronous, for callers that only hold an environment id. */
export function isWslVshudEnvironmentId(environmentId: string): boolean {
  return environmentId.startsWith(WSL_VSHUD_ENVIRONMENT_ID_PREFIX)
}
