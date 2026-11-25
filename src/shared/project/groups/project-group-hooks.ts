import type {
  VshuHooks,
  RepoHookSettings,
  SetupRunPolicy
} from '../../workspace-setup/vshu-yaml-hook-types'
import type { SetupConfig } from '../../workspace-setup/hooks/vshu-hook-setup-config'
export type GroupHookCheckResult = {
  status?: 'ok' | 'error'
  hasHooks: boolean
  hooks: VshuHooks | null
  mayNeedUpdate: boolean
  unavailable?: 'wsl-distro-stopped' | 'wsl-distro-unverifiable'
  hookSettings?: RepoHookSettings
  setupRunPolicy: SetupRunPolicy
  setupConfig: SetupConfig | null
}
