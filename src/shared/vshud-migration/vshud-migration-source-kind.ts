/** Legacy SSH omits source.kind to preserve signed bytes/digests. Other kinds must set kind and omit sshTargetId:
 * older destinations strip unknown fields, then fail parsing instead of importing a non-SSH source as SSH. */
import type {
  VshudMigrationLocalWslManifestSource,
  VshudMigrationManifestSource,
  VshudMigrationSshManifestSource
} from './vshud-migration-manifest'
import { VSHUD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY } from '../remote-runtime/protocol/vshud-runtime-capabilities'

export const VSHUD_MIGRATION_SSH_RELAY_SOURCE_KIND = 'ssh-relay' as const

/** Non-SSH kinds and the destination capability that proves a destination parses each one. */
export const VSHUD_MIGRATION_SOURCE_KIND_CAPABILITIES = {
  'local-wsl': VSHUD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY
} as const

export type VshudMigrationNonSshSourceKind = keyof typeof VSHUD_MIGRATION_SOURCE_KIND_CAPABILITIES
export type VshudMigrationSourceKind =
  | typeof VSHUD_MIGRATION_SSH_RELAY_SOURCE_KIND
  | VshudMigrationNonSshSourceKind

export const VSHUD_MIGRATION_SOURCE_KIND_UNKNOWN = 'vshud_migration_source_kind_unknown'

/** A manifest source as it travels: this build may not know every field a newer peer signed. */
export type VshudMigrationWireSource = Readonly<Record<string, unknown>>

export function vshudMigrationManifestSourceKind(
  source: VshudMigrationWireSource
): VshudMigrationSourceKind {
  if (source.kind === undefined) {
    return VSHUD_MIGRATION_SSH_RELAY_SOURCE_KIND
  }
  // An explicit 'ssh-relay' is refused too: SSH has exactly one encoding, so one digest.
  if (isNonSshSourceKind(source.kind)) {
    return source.kind
  }
  throw new Error(VSHUD_MIGRATION_SOURCE_KIND_UNKNOWN)
}

function isNonSshSourceKind(kind: unknown): kind is VshudMigrationNonSshSourceKind {
  return typeof kind === 'string' && Object.hasOwn(VSHUD_MIGRATION_SOURCE_KIND_CAPABILITIES, kind)
}

/** The capability a destination must advertise before it may see this source; null for SSH. */
export function requiredVshudMigrationSourceCapability(
  source: VshudMigrationWireSource
): string | null {
  const kind = vshudMigrationManifestSourceKind(source)
  return kind === VSHUD_MIGRATION_SSH_RELAY_SOURCE_KIND
    ? null
    : VSHUD_MIGRATION_SOURCE_KIND_CAPABILITIES[kind]
}

export function isVshudMigrationLocalWslSource(
  source: VshudMigrationManifestSource
): source is VshudMigrationLocalWslManifestSource {
  return 'kind' in source && source.kind === 'local-wsl'
}

/** For the SSH conversion's own steps: a WSL manifest reaching them is a bug, never a fallback. */
export function requireVshudMigrationSshSource(
  source: VshudMigrationManifestSource
): VshudMigrationSshManifestSource {
  if (isVshudMigrationLocalWslSource(source)) {
    throw new Error('vshud_migration_source_not_ssh')
  }
  return source
}
