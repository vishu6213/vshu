import { createHash, randomUUID } from 'node:crypto'

import {
  VSHUD_MIGRATION_MANIFEST_VERSION,
  parseVshudMigrationManifest
} from '../../../../../shared/vshud-migration/vshud-migration-manifest-validation'

import type {
  VshudMigrationCatalogPayload,
  VshudMigrationManifest
} from '../../../../../shared/vshud-migration/vshud-migration-manifest'

import {
  VSHUD_MIGRATION_BLOB_KIND_CONTRACTS,
  type VshudMigrationBlobDescriptor
} from '../../../../../shared/vshud-migration/vshud-migration-blob-transfer'

import {
  vshudMigrationAutomationRunHistoryBlob,
  serializeVshudMigrationAutomationRunHistory,
  withVshudMigrationAutomationRunHistory
} from '../../../../../shared/vshud-migration/vshud-migration-automation-run-history'

import type { SshTarget } from '../../../../../shared/remote-runtime/ssh/ssh-types'
import type { Store } from '../../../loading-store/store'
import { collectVshudMigrationSourceCatalog } from './vshud-source-catalog'
import { computeVshudMigrationManifestSha256 } from '../../../../vshud/migration/vshud-migration-manifest-digest'
import {
  IDENTITY_VSHUD_MIGRATION_PATH_REWRITER,
  rewriteVshudMigrationPayloadPaths,
  type VshudMigrationPathRewriter
} from '../../path-rewrite/vshud-migration-path-rewrite'

import {
  VSHUD_MIGRATION_MANIFEST_TOO_LARGE,
  describeOversizedVshudMigrationPayload,
  formatKib
} from '../../../../managed-server/migration/catalog/vshud-migration-payload-capacity'

import { hasDormantState } from '../dormancy/vshud-migration-dormant-state'

export type VshudMigrationExportStore = Pick<
  Store,
  | 'collectVshudMigrationSourceDormantState'
  | 'getFolderWorkspaces'
  | 'getProjectGroups'
  | 'getRepos'
> & {
  /** Groups the server's record wins for: still read for row ownership, never exported. */
  serverOwnedProjectGroupIds?: ReadonlySet<string>
}

export type VshudMigrationManifestExportOptions = {
  migrationId?: string
  now?: () => Date
  destinationEnvironmentId?: string
  onlyCatalog?: VshudMigrationCatalogIds
  /** Maps source paths to destination paths before signing; identity for an SSH host. */
  rewrite?: VshudMigrationPathRewriter
  /** Re-export a journal written before run history moved out of the manifest, as it was signed. */
  inlineAutomationRuns?: boolean
}

export type VshudMigrationExportedBlob = {
  descriptor: VshudMigrationBlobDescriptor
  bytes: Buffer
}

export type VshudMigrationManifestExport = {
  manifest: VshudMigrationManifest
  /** The bytes of every blob the manifest names. */
  blobs: VshudMigrationExportedBlob[]
}

export function createVshudMigrationManifest(
  store: VshudMigrationExportStore,
  target: SshTarget,
  options: VshudMigrationManifestExportOptions = {}
): VshudMigrationManifest {
  return exportVshudMigrationManifest(store, target, options).manifest
}

export function exportVshudMigrationManifest(
  store: VshudMigrationExportStore,
  target: SshTarget,
  options: VshudMigrationManifestExportOptions = {}
): VshudMigrationManifestExport {
  const rewrite = options.rewrite ?? IDENTITY_VSHUD_MIGRATION_PATH_REWRITER
  const collected = restrictCatalog(
    collectVshudMigrationSourceCatalog(store, target),
    options.onlyCatalog
  )
  const serverOwned = store.serverOwnedProjectGroupIds
  const sourcePayload = serverOwned
    ? {
        ...collected,
        projectGroups: collected.projectGroups.filter((group) => !serverOwned.has(group.id))
      }
    : collected
  const source = {
    sshTargetId: target.id,
    sshTargetGeneration: target.generation ?? null,
    targetLabel: target.label
  }
  const dormantState = store.collectVshudMigrationSourceDormantState(
    source,
    sourcePayload,
    options.destinationEnvironmentId
  )
  // Select dormant state using source identities before rewriting destination paths.
  const rewritten = rewriteVshudMigrationPayloadPaths(
    { ...sourcePayload, ...(hasDormantState(dormantState) ? { dormantState } : {}) },
    rewrite
  )
  const { payload, runHistory } = options.inlineAutomationRuns
    ? { payload: rewritten, runHistory: null }
    : moveAutomationRunsToBlob(rewritten)
  const unsigned = {
    version: VSHUD_MIGRATION_MANIFEST_VERSION,
    migrationId: options.migrationId ?? randomUUID(),
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    source,
    payload,
    ...(options.destinationEnvironmentId
      ? { destinationEnvironmentId: options.destinationEnvironmentId }
      : {})
  }
  try {
    // Sign what the journal and the host read back: the parsed form (the parser keeps only the fields
    // it knows) of the JSON (a value with toJSON serializes differently), never the live objects.
    const { manifestSha256: _unsigned, ...normalized } = parseVshudMigrationManifest({
      ...JSON.parse(JSON.stringify(unsigned)),
      manifestSha256: UNSIGNED_DIGEST
    })
    if (runHistory) {
      // Refuse here what the destination's commit would refuse, while nothing is fenced.
      withVshudMigrationAutomationRunHistory(normalized, runHistory.bytes.toString('utf8'))
    }
    return {
      manifest: { ...normalized, manifestSha256: computeVshudMigrationManifestSha256(normalized) },
      blobs: runHistory ? [runHistory] : []
    }
  } catch (error) {
    if (error instanceof Error && error.message === VSHUD_MIGRATION_MANIFEST_TOO_LARGE) {
      throw new Error(describeOversizedVshudMigrationPayload(payload))
    }
    throw error
  }
}

/** Run history scales with every run ever kept, so it travels beside the manifest, never in it. */
function moveAutomationRunsToBlob(payload: VshudMigrationCatalogPayload): {
  payload: VshudMigrationCatalogPayload
  runHistory: VshudMigrationExportedBlob | null
} {
  if (!payload.dormantState?.automationRuns?.length) {
    return { payload, runHistory: null }
  }
  const { automationRuns, ...dormantState } = payload.dormantState
  // The JSON round trip matches what the manifest's own normalization keeps.
  const bytes = Buffer.from(
    serializeVshudMigrationAutomationRunHistory(JSON.parse(JSON.stringify(automationRuns))),
    'utf8'
  )
  const maxBytes = VSHUD_MIGRATION_BLOB_KIND_CONTRACTS['automation-run-history'].maxBytes
  if (bytes.length > maxBytes) {
    throw new Error(
      `This SSH host's automation run history is too large to move to its Vshu server ` +
        `(${formatKib(bytes.length)}, limit ${formatKib(maxBytes)}). Delete automations you no ` +
        `longer need from this host's projects; their run history goes with them. Then reconnect. ` +
        `(vshud_migration_automation_run_history_too_large)`
    )
  }
  const ref = { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length }
  return {
    payload: {
      ...payload,
      dormantState: { ...dormantState, automationRunHistory: ref }
    },
    runHistory: { descriptor: vshudMigrationAutomationRunHistoryBlob(ref), bytes }
  }
}

const UNSIGNED_DIGEST = '0'.repeat(64)

export type VshudMigrationCatalogIds = {
  repositoryIds: ReadonlySet<string>
  folderWorkspaceIds: ReadonlySet<string>
  projectGroupIds: ReadonlySet<string>
}

export function vshudMigrationCatalogIds(
  payloads: readonly VshudMigrationCatalogPayload[]
): VshudMigrationCatalogIds {
  return {
    repositoryIds: new Set(payloads.flatMap((p) => p.repositories.map((row) => row.id))),
    folderWorkspaceIds: new Set(payloads.flatMap((p) => p.folderWorkspaces.map((row) => row.id))),
    projectGroupIds: new Set(payloads.flatMap((p) => p.projectGroups.map((row) => row.id)))
  }
}

function restrictCatalog(
  payload: VshudMigrationCatalogPayload,
  ids: VshudMigrationCatalogIds | undefined
): VshudMigrationCatalogPayload {
  if (!ids) {
    return payload
  }
  return {
    repositories: payload.repositories.filter((row) => ids.repositoryIds.has(row.id)),
    folderWorkspaces: payload.folderWorkspaces.filter((row) => ids.folderWorkspaceIds.has(row.id)),
    projectGroups: payload.projectGroups.filter((row) => ids.projectGroupIds.has(row.id))
  }
}
