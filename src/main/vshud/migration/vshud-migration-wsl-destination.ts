// In-place WSL moves require the desktop-launched vshud in the source distro to own the unchanged paths.
import type { VshudMigrationManifestSource } from '../../../shared/vshud-migration/vshud-migration-manifest'
import { isVshudMigrationLocalWslSource } from '../../../shared/vshud-migration/vshud-migration-source-kind'
import { isWslHostVshudProcess } from '../../wsl/filesystem/wsl-guest-windows-drive-path'
import { VSHUD_WSL_DISTRO_GUID_ENV } from '../../../shared/remote-runtime/serve-supervisor/vshud-server-launch-env'

export const VSHUD_MIGRATION_SOURCE_NOT_THIS_HOST = 'vshud_migration_source_not_this_host'

export function servesLocalWslMigrationSource(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  return isWslHostVshudProcess(env, platform)
}

// E2E hosts stand in for a WSL host's vshud; a real one is identified by isWslHostVshudProcess.
export const VSHU_E2E_WSL_MOVE_DESTINATION_ENV = 'VSHU_E2E_WSL_MOVE_DESTINATION'

/**
 * Whether this host is a WSL move's destination: it installs moved panes' terminal history and
 * serves their stored scrollback. Every other host keeps that wire surface off.
 */
export function servesWslMovedPaneHistory(env: NodeJS.ProcessEnv = process.env): boolean {
  return isWslHostVshudProcess(env) || env[VSHU_E2E_WSL_MOVE_DESTINATION_ENV] === '1'
}

export function assertVshudMigrationSourceServedHere(
  source: VshudMigrationManifestSource,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): void {
  if (!isVshudMigrationLocalWslSource(source)) {
    return
  }
  // WSL distro names and their UNC forms are case-insensitive.
  const distro = env.WSL_DISTRO_NAME?.trim().toLowerCase()
  if (!servesLocalWslMigrationSource(env, platform) || distro !== source.distro.toLowerCase()) {
    throw new Error(VSHUD_MIGRATION_SOURCE_NOT_THIS_HOST)
  }
  // Re-registering a distro reuses its name, not its files; require its registry ID when supplied.
  const guid = env[VSHUD_WSL_DISTRO_GUID_ENV]?.trim().toLowerCase()
  if (source.distroGuid !== undefined && guid !== source.distroGuid.toLowerCase()) {
    throw new Error(VSHUD_MIGRATION_SOURCE_NOT_THIS_HOST)
  }
}
