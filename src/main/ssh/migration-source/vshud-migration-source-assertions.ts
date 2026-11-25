import { createHash } from 'node:crypto'
import {
  serializeVshudMigrationValue,
  type VshudMigrationManifest
} from '../../../shared/vshud-migration/vshud-migration-manifest'
import type { VshudMigrationSourceCutover } from '../../../shared/vshud-migration/vshud-migration-source-cutover'
import {
  exportVshudMigrationManifest,
  type VshudMigrationExportedBlob
} from '../../persistence/migrating-vshud-catalog/source/catalog/vshud-migration-manifest-export'
import { resolveVshudMigrationFence } from './vshud-migration-source-fence'
import { confirmVshudMigrationTerminalsUnderFence } from './vshud-migration-terminal-gate'
import { collectUntransferredDependentBlockers } from '../targets/ssh-target-vshud-dependents'
import type { VshudMigrationPreflightStore } from '../targets/ssh-target-vshud-preflight'

/** Returns the re-read bytes of the blobs the journaled manifest names; unchanged source proves them. */
export function assertVshudMigrationSourceUnchanged(
  context: { userDataPath: string; store: VshudMigrationPreflightStore },
  cutover: VshudMigrationSourceCutover
): VshudMigrationExportedBlob[] {
  const target = context.store.getSshTarget(cutover.sshTargetId)
  const fence = target ? resolveVshudMigrationFence(context.userDataPath, target) : null
  if (!target || fence?.state !== 'fenced' || fence.cutover.migrationId !== cutover.migrationId) {
    throw new Error('vshud_migration_source_fence_lost')
  }
  // Re-export with journaled identity/time/destination so only source changes affect comparison.
  const { manifest: current, blobs } = exportVshudMigrationManifest(context.store, target, {
    migrationId: cutover.migrationId,
    destinationEnvironmentId: cutover.destinationEnvironmentId,
    now: () => new Date(cutover.manifest.createdAt),
    inlineAutomationRuns: cutover.manifest.payload.dormantState?.automationRuns !== undefined
  })
  if (frozenSourceDigest(current) !== frozenSourceDigest(cutover.manifest)) {
    throw new Error('vshud_migration_source_changed')
  }
  if (collectUntransferredDependentBlockers(context.store, cutover.manifest).length > 0) {
    throw new Error('vshud_migration_source_dependencies_present')
  }
  const terminals = confirmVshudMigrationTerminalsUnderFence(
    context.store,
    target.id,
    cutover.bridgedPtyIds
      ? {
          verdict: 'bridged',
          relayVerdict: 'unverifiable',
          bridgedPtyIds: cutover.bridgedPtyIds,
          hostTerminals: 0
        }
      : { verdict: 'exited', provenPtyIds: cutover.provenPtyIds }
  )
  if (terminals.verdict === 'live' || terminals.verdict === 'unverifiable') {
    throw new Error(`vshud_migration_source_terminals_${terminals.verdict}`)
  }
  return blobs
}

/** Ignore mutable UI layout/focus/routing: the destination gets the journaled view, and tab churn must not invalidate migration. */
function frozenSourceDigest(manifest: VshudMigrationManifest): string {
  const { manifestSha256: _digest, payload, ...rest } = manifest
  const {
    version: _version,
    workspaceSession: _session,
    clientState: _client,
    // Retention preserves journaled bytes even if their tab closes during transfer.
    terminalScrollbackSnapshots: _snapshots,
    ...dormant
  } = payload.dormantState ?? {}
  // UI-only changes can introduce a dormant payload that export previously omitted as empty.
  const empty = Object.values(dormant).every(
    (value) => value === undefined || (Array.isArray(value) && value.length === 0)
  )
  const frozen = { ...rest, payload: { ...payload, dormantState: empty ? undefined : dormant } }
  return createHash('sha256').update(serializeVshudMigrationValue(frozen)).digest('hex')
}
