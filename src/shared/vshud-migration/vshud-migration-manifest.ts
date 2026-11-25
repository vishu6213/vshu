import type { FolderWorkspace } from '../folder-workspaces/folder-workspace-types'
import type { Automation } from '../automations/automation-definition'
import type { AutomationRun } from '../automations/history/automation-run'
import type { VshudMigrationManifestVersion } from './vshud-migration-manifest-validation'
import type { ProjectGroup } from '../project/groups/project-group-types'
import type { Repo } from '../repository/repo-types'
import type { SparsePreset } from '../worktree/create-types'
import type { WorkspaceLineage, WorktreeLineage } from '../worktree/lineage-types'
import type { WorktreeMeta } from '../worktree/meta-types'
import type { RetiredNameRegistry } from '../worktree/naming/retired-name-registry'
import type { WorkspaceSessionState } from '../workspace-session/workspace-session-state-types'
import type { VshudMigrationClientStatePayload } from './vshud-migration-client-state'
import type {
  VshudMigrationSnapshotUploadState,
  VshudMigrationTerminalScrollbackSnapshot
} from './vshud-migration-scrollback'
import type { VshudMigrationBlobUploadState } from './vshud-migration-blob-transfer'

import { isRecord } from './vshud-migration-manifest-fields'

/** The relay-era SSH source: on the wire it never carries `kind` (see vshud-migration-source-kind). */
export type VshudMigrationSshManifestSource = {
  sshTargetId: string
  sshTargetGeneration: number | null
  targetLabel: string
}

/** Explicit desktop WSL project scope prevents destination path inference; generation orders delta moves. */
export type VshudMigrationLocalWslManifestSource = {
  kind: 'local-wsl'
  distro: string
  /** The distro's registry id, when known: a re-registered distro of the same name is another one. */
  distroGuid?: string
  scopeRepoIds: string[]
  scopeFolderWorkspaceIds: string[]
  generation: number
}

export type VshudMigrationManifestSource =
  | VshudMigrationSshManifestSource
  | VshudMigrationLocalWslManifestSource

export type VshudMigrationCatalogPayload = {
  repositories: Repo[]
  projectGroups: ProjectGroup[]
  folderWorkspaces: FolderWorkspace[]
  dormantState?: VshudMigrationDormantStatePayload
}

export type VshudMigrationDormantWorktreeMeta = {
  sourceKey: string
  worktreeId: string
  meta: WorktreeMeta
}

export type VshudMigrationDormantWorktreeLineage = {
  sourceKey: string
  worktreeId: string
  lineage: WorktreeLineage
}

export type VshudMigrationDormantWorkspaceLineage = {
  sourceKey: string
  childWorkspaceKey: string
  lineage: WorkspaceLineage
}

export type VshudMigrationDormantRetiredNames = {
  repoId: string
  registry: RetiredNameRegistry
}

export type VshudMigrationDormantRetirementNamespace = {
  sourceNamespaceKeys: string[]
  namespaceKey: string
  registry: RetiredNameRegistry
}

export type VshudMigrationAutomationRunHistoryRef = {
  sha256: string
  byteLength: number
}

export type VshudMigrationDormantStatePayload = {
  version: 1
  worktreeMeta: VshudMigrationDormantWorktreeMeta[]
  worktreeLineage: VshudMigrationDormantWorktreeLineage[]
  workspaceLineage: VshudMigrationDormantWorkspaceLineage[]
  sparsePresets: SparsePreset[]
  retiredWorktreeNames: VshudMigrationDormantRetiredNames[]
  retiredWorktreeNamespaces: VshudMigrationDormantRetirementNamespace[]
  workspaceSession?: WorkspaceSessionState
  terminalScrollbackSnapshots?: VshudMigrationTerminalScrollbackSnapshot[]
  automations?: Automation[]
  /** Inline runs, as older desktops send them; never alongside `automationRunHistory`. */
  automationRuns?: AutomationRun[]
  /** Digest of the runs sent as an `automation-run-history` blob, so history never bounds the manifest. */
  automationRunHistory?: VshudMigrationAutomationRunHistoryRef
  /** Client-owned durable intent projected to the destination authority. */
  clientState?: VshudMigrationClientStatePayload
}

export type VshudMigrationManifest = {
  version: VshudMigrationManifestVersion
  migrationId: string
  createdAt: string
  source: VshudMigrationManifestSource
  payload: VshudMigrationCatalogPayload
  /** Destination runtime identity used to re-key desktop routing after commit. */
  destinationEnvironmentId?: string
  manifestSha256: string
}

export type VshudMigrationImportReceipt = {
  version: VshudMigrationManifestVersion
  migrationId: string
  manifestSha256: string
  source: VshudMigrationManifestSource
  importedAt: string
  repositoryIds: string[]
  projectGroupIds: string[]
  folderWorkspaceIds: string[]
}

export type VshudMigrationStagedCatalog = {
  version: VshudMigrationManifestVersion
  manifest: VshudMigrationManifest
  stagedAt: string
}

export type VshudMigrationCatalogState =
  | {
      state: 'absent'
      migrationId: string
      manifestSha256: string
    }
  | {
      state: 'staged'
      migrationId: string
      manifestSha256: string
      stagedAt: string
      snapshotUploads?: VshudMigrationSnapshotUploadState[]
      /** Blobs staged so far; absent from hosts without the blob channel. */
      blobUploads?: VshudMigrationBlobUploadState[]
    }
  | {
      state: 'committed'
      migrationId: string
      manifestSha256: string
      receipt: VshudMigrationImportReceipt
    }

export type VshudMigrationCatalogAbortResult = VshudMigrationCatalogState & {
  aborted: boolean
  durableAbsent?: true
}

export type VshudMigrationCatalogReference = Pick<
  VshudMigrationManifest,
  'migrationId' | 'manifestSha256'
>

/** An abort by reference: no receipt, since an evicted one is rebuilt only from the manifest. */
export type VshudMigrationCatalogReferenceAbortResult = VshudMigrationCatalogReference & {
  state: 'absent' | 'committed'
  aborted: boolean
  durableAbsent?: true
  /** The receipt was flushed before this answer; older hosts never send it. */
  durableCommitted?: true
}

export function vshudMigrationManifestHashInput(
  manifest: Omit<VshudMigrationManifest, 'manifestSha256'>
): string {
  return serializeVshudMigrationValue(manifest)
}

export function serializeVshudMigrationValue(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value))
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue)
  }
  if (!isRecord(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalizeJsonValue(entry)])
  )
}
