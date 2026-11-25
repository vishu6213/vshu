import type { PublicKnownRuntimeEnvironment } from '../host-catalog/runtime-environments'
import type { VshudTerminalCensus } from './vshud-terminal-census'
import type { VshudMigrationBlocker } from '../../vshud-migration/vshud-migration-preflight'
import type { VshudMigrationSourceCutoverPhase } from '../../vshud-migration/vshud-migration-source-cutover'
import type { VshudDaemonRetirementVerdict } from './vshud-stop-request'
import type { SshManagedServerLinkedProject } from '../ssh/ssh-types'
import type { VshudStaleLockEvidence } from './vshud-stale-lock-reclaim'

export const VSHUD_MANAGED_REMOTE_PORT = 6_768

/** Refused because terminals are, or may be, still running on the host. */
export type VshudManagedRefusal = {
  outcome: 'refused'
  verdict: 'live' | 'unverifiable'
  code: string
  reason: string
  /** Only saved state blocks, which a confirmed "Move anyway" leaves on this desktop. */
  canLeaveBehind?: true
}

export type VshudManagedDeferral = {
  outcome: 'deferred'
  candidateVersion: string
  code: string
  reason: string
  /** False when force cannot make the rejected lifecycle transition safe. */
  forceable?: boolean
}

/** The one deferral Update anyway may pass: counted terminals the daemon carries across. */
export const VSHUD_UPDATE_TERMINALS_RUNNING_CODE = 'vshud_update_terminals_running'

/** Deferrals over a census no daemon answered; force passes them only once the candidate proves no daemon is running. */
const VSHUD_UPDATE_UNCOUNTED_TERMINALS_CODES: ReadonlySet<string> = new Set([
  'vshud_update_terminal_census_unavailable',
  'vshud_update_daemon_protocol_unverifiable'
])

/** Forcing these may end terminals the server runs itself, so the user confirms that first. */
export function isVshudUncountedTerminalsDeferral(code: string): boolean {
  return VSHUD_UPDATE_UNCOUNTED_TERMINALS_CODES.has(code)
}

/** Update anyway passes counted live-terminal deferrals, preserves version admission, and requires the confirmed incumbent build. */
export type VshudManagedPastLiveTerminals = {
  incumbentVersion: string | null
  /** The terminal count was unknown; the user accepted that terminals the server runs itself end. */
  uncounted?: true
}

export type VshudManagedDeployResult =
  | {
      outcome: 'created' | 'updated' | 'already-current'
      environment: PublicKnownRuntimeEnvironment
      activeVersion: string
    }
  | VshudManagedDeferral

export type VshudManagedRollbackResult =
  | {
      outcome: 'rolled-back'
      environment: PublicKnownRuntimeEnvironment
      activeVersion: string
      discarded: string[]
    }
  | { outcome: 'refused' | 'failed'; code: string; reason: string }

/** A recovery that needs the operator to accept restoring a snapshot over changed state. */
export const VSHUD_RECOVERY_CHANGED_STATE_CODE = 'vshud_recovery_changed_state'

export type VshudManagedRecoveryResult =
  | { outcome: 'none' }
  | { outcome: 'pending'; code: string; reason: string }
  | {
      outcome: 'recovered'
      resolution: 'committed' | 'restored-incumbent'
      activeVersion: string | null
      environment: PublicKnownRuntimeEnvironment
    }
  | VshudManagedRefusal

/** Only a proven `exited` unlinks the server locally; anything less keeps it linked. */
export type VshudManagedStopResult =
  | {
      outcome: 'unlinked'
      verdict: 'exited'
      environmentId: string
      sshTargetId: string
      stoppedVersion: string | null
      retirement: VshudDaemonRetirementVerdict | null
    }
  | VshudManagedRefusal

/** Refuse restart with live or unverifiable terminals: the daemon outlives vshud and retains its inherited environment. */
export type VshudManagedRestartResult =
  | { outcome: 'restarted'; environmentId: string }
  | { outcome: 'terminals-running'; liveSessions: number | null }
  | { outcome: 'not-restarted'; reason: string }

/** A dry run, or a confirmation pinned to the lock record that dry run showed. */
export type VshudManagedStaleLockReclaimRequest =
  | { yes: false }
  | { yes: true; expectNonce: string }

/** `vshud --reclaim-stale-lock` run on a managed host's active slot (#32177). */
export type VshudManagedStaleLockReclaimResult =
  | {
      status: 'none' | 'eligible' | 'refused'
      message: string
      lockPath: string
      evidence?: VshudStaleLockEvidence
    }
  /** `notRestarted` says why the server did not start again once its lock was cleared. */
  | {
      status: 'reclaimed'
      environmentId: string
      message: string
      lockPath: string
      /** The record the reclaim acted on. */
      evidence?: VshudStaleLockEvidence
      notRestarted?: string
    }
  /** No remote reclaim occurred. reclaimWithoutPin requires manual reclaim because the host cannot pin confirmation;
   * otherwise lockPath names the lock to delete manually. */
  | { status: 'unsupported'; message: string; lockPath?: string; reclaimWithoutPin?: true }
  /** The slot runs the command but gave no answer this client understands; nothing is known. */
  | { status: 'no-answer'; message: string }
  /** Another lifecycle step holds the host; nothing changed. */
  | { status: 'busy'; message: string }

/** Forget only unlinks this desktop; an unreachable server may still run, so its verdict remains unverifiable. */
export type VshudManagedForgetResult =
  | {
      outcome: 'forgotten'
      verdict: 'unverifiable'
      environmentId: string
      sshTargetId: string
    }
  | VshudManagedRefusal

export type VshudManagedCancelStopResult =
  | { outcome: 'none' }
  /** The stop was withdrawn before vshud acted on it; the server keeps serving. */
  | { outcome: 'canceled'; activeVersion: string }
  /** vshud had already exited; finish with stop to unlink the server. */
  | { outcome: 'already-stopped' }
  | VshudManagedRefusal

export type VshudManagedRuntimeStatus = {
  environmentId: string
  sshTargetId: string
  activeVersion: string | null
  previousVersion: string | null
  activatedAt: string | null
  rollbackAvailable: boolean
  recovery:
    | {
        operation: 'activate'
        phase: 'prepared' | 'incumbent-stopped' | 'snapshot-captured' | 'candidate-ready'
        version: string
        startedAt: string
      }
    | {
        operation: 'rollback'
        phase:
          | 'prepared'
          | 'incumbent-stopped'
          | 'rescue-captured'
          | 'rollback-state-restored'
          | 'target-ready'
        version: string
        startedAt: string
      }
    | {
        operation: 'decommission'
        phase: 'prepared' | 'stop-dispatched' | 'process-exited'
        version: string
        startedAt: string
      }
    | null
  /** Terminals the daemon runs; `null` counts are unverifiable and block updates and stops. */
  terminals: VshudTerminalCensus
  /** An unfinished dormant migration into this server; a rollback is refused while it runs. */
  migration: {
    migrationId: string
    phase: VshudMigrationSourceCutoverPhase
    startedAt: string
  } | null
  /** The last update this client deferred for this server, cleared once one goes through. */
  deferredUpdate: (VshudManagedDeferral & { deferredAt: string }) | null
  /** The Vshu release that activated `activeVersion`; absent when unknown or from older desktops. */
  activeAppVersion?: string | null
  /** This desktop's bundled build when Update would move the host to it; absent from older desktops. */
  availableUpdate?: string | null
}

export type VshudManagedConversionResult =
  | {
      /** Committed on the server and retired from the SSH host. */
      outcome: 'converted'
      environment: PublicKnownRuntimeEnvironment
      migrationId: string
      /** Projects the server already held, so this desktop's own state for them did not move. */
      linkedProjects?: SshManagedServerLinkedProject[]
      /** Moved automations the server would not re-enable; they stay off there. */
      automationsLeftDisabled?: number
    }
  | VshudManagedDeferral
  | VshudManagedRefusal

export type VshudManagedPendingMigrationRow = {
  migrationId: string
  environmentId: string
  name: string
  sshTargetId: string
  phase: VshudMigrationSourceCutoverPhase
  startedAt: string
}

export type VshudDeltaMoveRow = {
  kind: 'repository' | 'folder-workspace' | 'project-group'
  id: string
  label: string
}

/** What moving a host's newer projects would add, and what the server will keep as it is. */
export type VshudDeltaMovePreview = {
  sshTargetId: string
  environmentId: string
  added: VshudDeltaMoveRow[]
  /** Projects an older build changed or removed; the server keeps its own copy of these. */
  notReflected: { edited: VshudDeltaMoveRow[]; removed: VshudDeltaMoveRow[] }
  blockers: VshudMigrationBlocker[]
}

export type VshudDeltaMoveResult =
  | { outcome: 'moved'; migrationId: string }
  | { outcome: 'refused'; code: string; reason: string; blockers?: VshudMigrationBlocker[] }
