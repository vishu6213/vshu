import { createHash } from 'node:crypto'

import {
  type VshudMigrationBlobDescriptor,
  sameVshudMigrationBlob
} from '../../../../shared/vshud-migration/vshud-migration-blob-transfer'
import {
  MAX_VSHUD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES,
  VSHUD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
  VSHUD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION,
  parseVshudMigrationTerminalRestoreHintsDocument,
  type VshudMigrationTerminalRestoreHint
} from '../../../../shared/vshud-migration/vshud-migration-terminal-restore-hints'
import type { VshudMigrationBlobSource } from '../../../managed-server/migration/transfers/vshud-migration-blob-coordinator'

export type WslMoveRestoreHintsBlob = {
  descriptor: VshudMigrationBlobDescriptor
  bytes: Buffer
  source: VshudMigrationBlobSource
}

/** Omit the blob when there are no hints. */
export function buildWslMoveRestoreHintsBlob(
  hints: readonly VshudMigrationTerminalRestoreHint[]
): WslMoveRestoreHintsBlob | null {
  if (hints.length === 0) {
    return null
  }
  // Validate before staging so malformed hints fail while the source still owns the move.
  const document = parseVshudMigrationTerminalRestoreHintsDocument({
    version: VSHUD_MIGRATION_TERMINAL_RESTORE_HINTS_VERSION,
    hints: hints.map((hint) => ({ paneKey: hint.paneKey, cwd: hint.cwd }))
  })
  const bytes = Buffer.from(JSON.stringify(document), 'utf8')
  if (bytes.length > MAX_VSHUD_MIGRATION_TERMINAL_RESTORE_HINTS_BYTES) {
    throw new Error('vshud_migration_terminal_restore_hints_too_large')
  }
  const descriptor: VshudMigrationBlobDescriptor = {
    blobKind: 'terminal-restore-hints',
    key: VSHUD_MIGRATION_TERMINAL_RESTORE_HINTS_KEY,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length
  }
  return {
    descriptor,
    bytes,
    source: {
      readChunk: async (requested, offset, maxBytes) => {
        if (!sameVshudMigrationBlob(requested, descriptor)) {
          throw new Error(`vshud_migration_source_blob_changed:${requested.blobKind}`)
        }
        return bytes.subarray(offset, offset + maxBytes)
      }
    }
  }
}
