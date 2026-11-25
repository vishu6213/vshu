import {
  vshudMigrationAutomationRunHistoryBlob,
  withVshudMigrationAutomationRunHistory
} from '../../../../shared/vshud-migration/vshud-migration-automation-run-history'
import type { VshudMigrationManifest } from '../../../../shared/vshud-migration/vshud-migration-manifest'
import { readVshudMigrationBlob } from '../blob-transfer/vshud-migration-blob-staging'

/** The manifest signs the history's digest, so its rows import with the catalog or not at all. */
export function withStagedAutomationRunHistory(
  manifest: VshudMigrationManifest,
  blobRoot: string
): VshudMigrationManifest {
  const ref = manifest.payload.dormantState?.automationRunHistory
  if (!ref) {
    return manifest
  }
  const descriptor = vshudMigrationAutomationRunHistoryBlob(ref)
  return withVshudMigrationAutomationRunHistory(
    manifest,
    readVshudMigrationBlob(manifest, blobRoot, descriptor).toString('utf8')
  )
}
