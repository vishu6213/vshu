import type { PersistedState } from '../../../../shared/vshu-profiles/persisted-state-types'

import {
  type VshudMigrationDormantStatePayload,
  serializeVshudMigrationValue
} from '../../../../shared/vshud-migration/vshud-migration-manifest'
import { canonicalWorktreeIdentity } from '../../../../shared/worktree/identity'
import { composeWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import { omitDefaultWorktreeMetaFields } from '../../../../shared/worktree/metadata/meta-persisted-defaults'

export function assertVshudDestinationCanonicalMetadata(
  state: PersistedState,
  entries: VshudMigrationDormantStatePayload['worktreeMeta']
): void {
  for (const { worktreeId, meta } of entries) {
    const alias = composeWorktreeHostIdentity('local', worktreeId)
    const identities = state.worktreeIdentityAliases?.[alias] ?? []
    const expectedKey = meta.instanceId
      ? canonicalWorktreeIdentity({
          worktreeId,
          executionHostId: 'local',
          instanceId: meta.instanceId
        })
      : undefined
    const candidates = new Set([
      ...identities,
      ...(expectedKey && state.worktreeMetaByIdentity?.[expectedKey] ? [expectedKey] : [])
    ])
    if (
      candidates.size > 1 ||
      [...candidates].some((key) => {
        const current = state.worktreeMetaByIdentity?.[key]
        return (
          !current ||
          key !== expectedKey ||
          serializeVshudMigrationValue(omitDefaultWorktreeMetaFields(current)) !==
            serializeVshudMigrationValue(omitDefaultWorktreeMetaFields(meta))
        )
      })
    ) {
      throw new Error(`vshud_migration_dormant_id_conflict:worktree_meta:${worktreeId}`)
    }
  }
}
