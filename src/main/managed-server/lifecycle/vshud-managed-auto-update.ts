import {
  planManagedVshudAutoUpdate,
  type ManagedVshudAutoUpdateSkip
} from './vshud-managed-update-decision'
import { VshudCrashLoopError } from './vshud-managed-crash-loop'
import { materializeVshudArtifact } from '../../vshud/artifact-slots/vshud-artifact-materializer'
import {
  VshudArtifactsUnavailableError,
  VshudHostUnsupportedError
} from '../../vshud/diagnostics/vshud-host-unavailable'
import { findIncompleteManagedVshudMigration } from './vshud-managed-migration-status'
import { VSHUD_ACTIVATION_FENCE_BUSY_CODE } from '../activation/vshud-activation-fence-hold'
import { resolveLinkedVshudContext } from './vshud-managed-runtime-context'
import { runManagedVshudUpdate } from './vshud-runtime-maintenance'
import { withManagedVshudLifecycle } from './vshud-managed-lifecycle'
import type { VshudUpdateDeferCode } from '../activation/vshud-update-plan'
import { readLocalFullVersion } from '../install/remote-versioned-install'

export type ManagedVshudAutoUpdateOutcome =
  | { outcome: 'skipped'; reason: ManagedVshudAutoUpdateSkip }
  | { outcome: 'updated'; activeVersion: string }
  | { outcome: 'deferred'; code: string; reason: string }
  /** Candidate rejection or update failure; consult host state before assuming the incumbent serves. */
  | { outcome: 'failed'; reason: string }

const WAITING_CODES: ReadonlySet<string> = new Set<
  VshudUpdateDeferCode | typeof VSHUD_ACTIVATION_FENCE_BUSY_CODE
>([
  VSHUD_ACTIVATION_FENCE_BUSY_CODE,
  'vshud_update_terminals_running',
  'vshud_update_terminal_census_unavailable',
  'vshud_update_strands_live_terminals',
  'vshud_update_daemon_protocol_unverifiable',
  'vshud_update_ends_in_process_terminals'
])

/** Temporary deferrals retry on later connects; interrupted activations require recovery. */
export function isWaitingVshudUpdateDeferral(code: string): boolean {
  return WAITING_CODES.has(code)
}

export async function autoUpdateManagedVshudEnvironment(
  userDataPath: string,
  args: {
    environmentId: string
    appVersion: string
    /** Read under the lifecycle lock to observe prior overlapping attempts. */
    failedBefore: () => boolean
    onUpdating: () => void
  }
): Promise<ManagedVshudAutoUpdateOutcome> {
  return await withManagedVshudLifecycle(userDataPath, args.environmentId, async (managed) => {
    // Restarting during migration would race cutover staging.
    if (findIncompleteManagedVshudMigration(userDataPath, managed.environment.id)) {
      return { outcome: 'skipped', reason: 'migrating' }
    }
    const context = await resolveLinkedVshudContext(managed.environment, managed.deployment)
    const candidateVersion = await bundledManagedVshudVersion(context.serverTarget)
    const plan = planManagedVshudAutoUpdate({
      record: context.activationRecord,
      candidateVersion,
      appVersion: args.appVersion,
      failedBefore: args.failedBefore()
    })
    if (plan.action === 'skip') {
      return { outcome: 'skipped', reason: plan.reason }
    }
    args.onUpdating()
    let lockedSkip: ManagedVshudAutoUpdateSkip | null = null
    try {
      const result = await runManagedVshudUpdate(userDataPath, managed, context, {
        // Another desktop may activate or stop a newer build during upload; recheck under the fence.
        admitRecord: (record) => {
          const locked = planManagedVshudAutoUpdate({
            record,
            candidateVersion,
            appVersion: args.appVersion,
            failedBefore: false
          })
          if (locked.action === 'update') {
            return null
          }
          lockedSkip = locked.reason
          return `Auto-update skipped under the host fence: ${locked.reason}.`
        }
      })
      if (lockedSkip) {
        return { outcome: 'skipped', reason: lockedSkip }
      }
      if (result.outcome !== 'deferred') {
        return { outcome: 'updated', activeVersion: result.activeVersion }
      }
      return isWaitingVshudUpdateDeferral(result.code)
        ? { outcome: 'deferred', code: result.code, reason: result.reason }
        : { outcome: 'failed', reason: result.reason }
    } catch (error) {
      // The host already runs this build; the brake's reason shows on its server status instead.
      if (error instanceof VshudCrashLoopError) {
        return { outcome: 'skipped', reason: 'current' }
      }
      return { outcome: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
  })
}

type VshudTarget = Parameters<typeof materializeVshudArtifact>[0]

// Packaged templates cannot change during this session; avoid repeated hashing.
const bundledVersions = new Map<VshudTarget, Promise<string | null>>()

/** This build's vshud version for `target`; null when the build bundles none for it. */
export function bundledManagedVshudVersion(target: VshudTarget): Promise<string | null> {
  let version = bundledVersions.get(target)
  if (!version) {
    version = materializeVshudArtifact(target).then(readLocalFullVersion, (error: unknown) => {
      if (
        error instanceof VshudHostUnsupportedError ||
        error instanceof VshudArtifactsUnavailableError
      ) {
        return null
      }
      throw error
    })
    // A transient local failure must not stick for the session.
    version.catch(() => bundledVersions.delete(target))
    bundledVersions.set(target, version)
  }
  return version
}

export function resetBundledVshudVersionsForTests(): void {
  bundledVersions.clear()
}
