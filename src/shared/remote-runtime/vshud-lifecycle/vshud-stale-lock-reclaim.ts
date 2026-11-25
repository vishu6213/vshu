/** Explicit lock recovery for cases automatic startup cannot judge, such as shared-home reboot (#32177).
 * Dependency-free so clients, CLI and launcher share the command/result. */
import { quotePosixShellUnlessPlain } from '../../shell/launch/shell-argument-quoting'

export const VSHUD_RECLAIM_STALE_LOCK_FLAG = '--reclaim-stale-lock'
export const VSHUD_STALE_LOCK_DATA_ROOT_FLAG = '--data-root'
/** Pin confirmation to dry-run evidence. Clients probe this flag in bundles; reclaim alone cannot confirm safely. */
export const VSHUD_STALE_LOCK_EXPECT_NONCE_FLAG = '--expect-nonce'

/** `--json` prints one of these; the exit code names the status too. */
export type VshudStaleLockReclaimStatus = 'none' | 'eligible' | 'refused' | 'reclaimed'

export type VshudStaleLockEvidence = {
  pid: number
  host: string
  bootId: string
  currentBootId: string
  ageMinutes: number
  /** The record's own nonce, for `--expect-nonce`; absent from builds before the pin. */
  nonce?: string
}

// Why `none` is not 0: a command pointed at the wrong data root must never read as a recovery.
export const VSHUD_STALE_LOCK_RECLAIM_EXIT_CODES: Record<VshudStaleLockReclaimStatus, number> = {
  reclaimed: 0,
  refused: 1,
  eligible: 2,
  none: 4
}

/** Managed hosts lack vshu/vshud on PATH, so pasteable hints must name the holder’s runtime, entry and data root. */
export type VshudReclaimHintRuntime = { execPath: string; entry: string | undefined }

export function vshudStaleLockReclaimCommand(
  dataRoot: string,
  runtime: VshudReclaimHintRuntime | null
): string {
  const program = runtime?.entry
    ? `${quotePosixShellUnlessPlain(runtime.execPath)} ${quotePosixShellUnlessPlain(runtime.entry)}`
    : 'vshu serve'
  return `${program} ${VSHUD_RECLAIM_STALE_LOCK_FLAG} ${VSHUD_STALE_LOCK_DATA_ROOT_FLAG} ${quotePosixShellUnlessPlain(dataRoot)}`
}
