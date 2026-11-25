import { createProfileStateStoreForStartup } from '../../persistence/profile-state/startup/profile-state-startup-authority'
import type { ProfileStateStoreFactoryResult } from '../../persistence/profile-state/startup/profile-state-store-factory'
import { ensureActiveVshuProfile } from '../../vshu-profiles/profile-index-store'
import { initVshuProfilePaths } from '../../vshu-profiles/profile-storage-paths'
import { initSshHostKeyStoreFile } from '../../ssh/host-keys/ssh-host-key-store'
import { initVshudHeldFenceTokenFile } from '../../managed-server/activation/vshud-held-fence-tokens'
import { emitVshudProfileStateAuthoritySelected } from './vshud-profile-state-telemetry'
import { isWslHostVshudProcess } from '../../wsl/filesystem/wsl-guest-windows-drive-path'
import { recordVshudServedProfile } from '../vshud-served-profile'

/** WSL hosts are held to a per-distro memory budget; the idle writer thread costs ~13-15 MB. */
export const WSL_HOST_PROFILE_WRITER_IDLE_STOP_MS = 60_000

/** SSH hosts and the desktop keep their writer thread running. */
export function vshudProfileWriterIdleStopMs(
  isWslHost: () => boolean = isWslHostVshudProcess
): number | undefined {
  return isWslHost() ? WSL_HOST_PROFILE_WRITER_IDLE_STOP_MS : undefined
}

type VshudProfileStateStartup = {
  store: ProfileStateStoreFactoryResult['store']
  authority: {
    backend: ProfileStateStoreFactoryResult['backend']
    classification: ProfileStateStoreFactoryResult['classification']
    authority_mode: 'sqlite-established'
    runtime: 'vshud'
    migrated: boolean
  }
}

export async function createVshudProfileStateStartup(
  userDataPath: string
): Promise<VshudProfileStateStartup> {
  initVshuProfilePaths()
  const profile = ensureActiveVshuProfile(userDataPath)
  // Real persistence avoids falsely empty RPCs; headless authority keeps automations owned by this host.
  const result = await createProfileStateStoreForStartup({
    userDataPath,
    dataFile: profile.dataFile,
    databaseFile: profile.stateDatabaseFile,
    profileId: profile.profile.id,
    runtime: 'vshud',
    storageAuthority: 'runtime',
    writerIdleStopMs: vshudProfileWriterIdleStopMs()
  })
  const authority = {
    backend: result.backend,
    classification: result.classification,
    authority_mode: 'sqlite-established' as const,
    runtime: 'vshud' as const,
    migrated: result.migrated
  }
  try {
    initSshHostKeyStoreFile(profile.dataFile)
    initVshudHeldFenceTokenFile(profile.dataFile)
    emitVshudProfileStateAuthoritySelected(authority)
    recordVshudServedProfile(profile.profile.id)
    return { store: result.store, authority }
  } catch (error) {
    try {
      await result.store.freezeWritesAsync()
    } catch (closeError) {
      console.error(
        '[persistence] Failed to close profile persistence after startup failure:',
        closeError
      )
    }
    throw error
  }
}
