import { VSHUD_MIGRATION_SSH_RELAY_SOURCE_KIND } from '../../../shared/vshud-migration/vshud-migration-source-kind'
import type { SshTarget } from '../../../shared/remote-runtime/ssh/ssh-types'
import { collectVshudMigrationSourceCatalog } from '../../persistence/migrating-vshud-catalog/source/catalog/vshud-source-catalog'
import type { Store } from '../../persistence/loading-store/store'
import { createVshudMigrationManifest } from '../../persistence/migrating-vshud-catalog/source/catalog/vshud-migration-manifest-export'
import { IDENTITY_VSHUD_MIGRATION_PATH_REWRITER } from '../../persistence/migrating-vshud-catalog/path-rewrite/vshud-migration-path-rewrite'
import type {
  VshudMigrationSource,
  VshudMigrationSourceCutoverPort
} from '../../managed-server/migration/cutover/vshud-migration-source'
import { assertVshudMigrationSourceUnchanged } from './vshud-migration-source-assertions'
import {
  fenceVshudMigrationSource,
  releaseVshudMigrationFence,
  resolveVshudMigrationFence
} from './vshud-migration-source-fence'
import {
  assessVshudMigrationTerminals,
  retireProvenExitedLeases,
  type CensusHostRelayTerminals
} from './vshud-migration-terminal-gate'
import type { SshTargetVshudClaims } from '../targets/ssh-target-vshud-claims'
import type { VshudMigrationPreflightStore } from '../targets/ssh-target-vshud-preflight'
import type { VshudMigrationPaneLeasePredicate } from './vshud-migration-bridged-panes'

type SshRelayCutoverDeps = {
  userDataPath: string
  store: VshudMigrationPreflightStore
  claims: SshTargetVshudClaims
  /** Rebuild copied stores for every check so later edits remain visible. */
  freshSource?: () => VshudMigrationPreflightStore
  signal?: AbortSignal
}

export function sshRelayMigrationCutoverPort(
  deps: SshRelayCutoverDeps
): VshudMigrationSourceCutoverPort {
  return {
    verifyFence: (cutover) =>
      assertVshudMigrationSourceUnchanged(
        { userDataPath: deps.userDataPath, store: deps.freshSource?.() ?? deps.store },
        cutover
      ),
    releaseFence: (cutover) => releaseVshudMigrationFence(deps, cutover)
  }
}

export function createSshRelayMigrationSource(
  deps: SshRelayCutoverDeps & {
    store: VshudMigrationPreflightStore &
      Pick<Store, 'getSshRemotePtyLeases' | 'markSshRemotePtyLease'>
    target: SshTarget
    /** Every relay endpoint on the host's account; without it exit can never be proven. */
    censusHost?: CensusHostRelayTerminals | null
    isBridgedPaneLease?: VshudMigrationPaneLeasePredicate
  }
): VshudMigrationSource {
  const { userDataPath, store, target } = deps
  return {
    ...sshRelayMigrationCutoverPort(deps),
    kind: VSHUD_MIGRATION_SSH_RELAY_SOURCE_KIND,
    journalKey: target.id,
    collectCatalog: () => collectVshudMigrationSourceCatalog(store, target),
    exportManifest: (options = {}) =>
      createVshudMigrationManifest(store, target, {
        ...options,
        rewrite: IDENTITY_VSHUD_MIGRATION_PATH_REWRITER
      }),
    assessTerminals: () => assessVshudMigrationTerminals(store, target.id, deps.censusHost),
    retireProvenExitedTerminals: (proof) => retireProvenExitedLeases(store, target.id, proof),
    resolveFence: () => resolveVshudMigrationFence(userDataPath, target),
    acquireFence: (args) =>
      fenceVshudMigrationSource({
        userDataPath,
        store,
        claims: deps.claims,
        targetId: target.id,
        isBridgedPaneLease: deps.isBridgedPaneLease,
        ...args
      })
  }
}
