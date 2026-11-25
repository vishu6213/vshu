import type { VshudMigrationCatalogState } from '../../../../shared/vshud-migration/vshud-migration-manifest'

export async function resolveDurableVshudCatalogMutation(
  mutate: () => Promise<VshudMigrationCatalogState>,
  read: () => Promise<VshudMigrationCatalogState>,
  accepted: (state: VshudMigrationCatalogState) => boolean
) {
  try {
    return await mutate()
  } catch (mutationError) {
    let observed: VshudMigrationCatalogState
    try {
      observed = await read()
    } catch {
      throw mutationError
    }
    if (!accepted(observed)) {
      throw mutationError
    }
  }
  // State reads may reflect unflushed mutations; an idempotent acknowledgment proves durability.
  return mutate()
}
