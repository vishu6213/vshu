/** Finished automation runs travel as one blob; the signed manifest carries only its digest, so run
 * history never bounds the manifest. Format changes require a new capability. */
import type { AutomationRun } from '../automations/history/automation-run'
import type { VshudMigrationBlobDescriptor } from './vshud-migration-blob-transfer'
import {
  serializeVshudMigrationValue,
  type VshudMigrationAutomationRunHistoryRef,
  type VshudMigrationManifest
} from './vshud-migration-manifest'
import { parseVshudMigrationCatalogPayload } from './vshud-migration-manifest-validation'
import { requiredRecord } from './vshud-migration-dormant-value-validation'

const VSHUD_MIGRATION_AUTOMATION_RUN_HISTORY_VERSION = 1

/** Canonical, so a re-export of an unchanged source reproduces the journaled digest. */
export function serializeVshudMigrationAutomationRunHistory(
  runs: readonly AutomationRun[]
): string {
  return serializeVshudMigrationValue({
    version: VSHUD_MIGRATION_AUTOMATION_RUN_HISTORY_VERSION,
    runs
  })
}

export function vshudMigrationAutomationRunHistoryBlob(
  ref: VshudMigrationAutomationRunHistoryRef
): VshudMigrationBlobDescriptor {
  return { blobKind: 'automation-run-history', key: 'migration', ...ref }
}

/** Blobs the manifest itself names; its commit is refused until they are staged. */
export function vshudMigrationManifestBlobs(
  manifest: Pick<VshudMigrationManifest, 'payload'>
): VshudMigrationBlobDescriptor[] {
  const ref = manifest.payload.dormantState?.automationRunHistory
  return ref ? [vshudMigrationAutomationRunHistoryBlob(ref)] : []
}

/** The manifest with its runs inline, validated against its own catalog as inline runs would be. */
export function withVshudMigrationAutomationRunHistory<
  T extends Pick<VshudMigrationManifest, 'payload'>
>(manifest: T, text: string): T {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch {
    throw new Error('vshud_migration_automation_run_history_invalid')
  }
  const record = requiredRecord(document, 'vshud_migration_automation_run_history_invalid')
  if (record.version !== VSHUD_MIGRATION_AUTOMATION_RUN_HISTORY_VERSION) {
    throw new Error('vshud_migration_automation_run_history_version_unsupported')
  }
  const { automationRunHistory: _ref, ...dormantState } = manifest.payload.dormantState ?? {}
  return {
    ...manifest,
    payload: parseVshudMigrationCatalogPayload({
      ...manifest.payload,
      dormantState: { ...dormantState, automationRuns: record.runs }
    })
  }
}
