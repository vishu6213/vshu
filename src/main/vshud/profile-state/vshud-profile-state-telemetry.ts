import type { ProfileStateStorageClassification } from '../../persistence/profile-state/database/profile-state-storage-classification'

/** Exclude paths, profile IDs and serialized state from fleet telemetry. */
export type VshudProfileStateAuthoritySelection = {
  backend: 'sqlite'
  classification: ProfileStateStorageClassification
  authority_mode: 'sqlite-established'
  runtime: 'vshud'
  migrated: boolean
}

type VshudProfileStateTelemetrySink = (line: string) => void

export function formatVshudProfileStateAuthoritySelected(
  selection: VshudProfileStateAuthoritySelection
): string {
  // Select fields explicitly so structural typing cannot leak extra runtime data.
  return `[vshud-telemetry] ${JSON.stringify({
    event: 'profile_state_authority_selected',
    backend: selection.backend,
    classification: selection.classification,
    authority_mode: selection.authority_mode,
    runtime: selection.runtime,
    migrated: selection.migrated
  })}`
}

/** Use stderr without desktop dependencies; telemetry failures must not block serving. */
export function emitVshudProfileStateAuthoritySelected(
  selection: VshudProfileStateAuthoritySelection,
  sink: VshudProfileStateTelemetrySink = (line) => console.error(line)
): void {
  try {
    sink(formatVshudProfileStateAuthoritySelected(selection))
  } catch {}
}
