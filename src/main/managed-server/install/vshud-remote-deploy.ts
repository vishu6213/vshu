/** Activate under a durable host fence/journal only after candidate readiness. Recover the incumbent only with safe profile state; retain changed state/snapshot for explicit recovery. */
import { logVshudActivationOutcome } from '../activation/vshud-activation-outcome-log'
import { join } from 'node:path'
import type { VshudHostTransport } from './vshud-host-transport'
import type { VshudUpdateForce } from '../activation/vshud-update-plan'
import { VSHUD_INSTALL_MODEL } from './remote-install-model'
import { computeRemoteInstallDir, readLocalFullVersion } from './remote-versioned-install'
import { readVshudActivationRecord } from '../activation/vshud-activation-record-store'
import type { VshudActivationRecord } from '../activation/vshud-activation-record'
import type { VshudActivationVerdict } from '../activation/vshud-activation-gate'
import type { VshudTerminalCensus } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-terminal-census'
import type { RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { installVshudBundle } from './vshud-remote-install'
import type { InstallLockWait } from './remote-install-lock'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import type { NodeRuntimeTarget } from '../../../shared/node-runtime/node-runtime-pin'
import { VSHUD_STARTUP_READINESS_TIMEOUT_MS } from '../../../shared/remote-runtime/vshud-distribution/vshud-profile-preflight'
import { materializeVshudArtifact } from '../../vshud/artifact-slots/vshud-artifact-materializer'
import { readVshudBundleTarget } from './vshud-deployment-target'
import { resolveVshudRuntimeTarget } from '../lifecycle/vshud-runtime-target'
import {
  vshudNodeRuntimeInstallOptions,
  type NodeRuntimeDownloadBudget
} from './vshud-node-runtime-install-options'
import {
  vshudActivationFenceExists,
  resolveVshudActivationReadinessTimeout,
  withVshudActivationLock
} from '../activation/vshud-activation-lock'
import { activateInstalledVshud } from '../activation/vshud-installed-activation'
import { vshudActivationFenceRefusal } from '../activation/vshud-activation-fence-hold'

export type VshudDeployOptions = {
  conn: VshudHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  /** An already assembled bundle; otherwise materialize the packaged template for this host. */
  localVshudDir?: string
  /** The bundle's runtime target; read from `localVshudDir` or probed when absent. */
  target?: NodeRuntimeTarget
  /** Where the pinned runtime archive is cached; defaults beside the vshud artifact cache. */
  runtimeCacheRoot?: string
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  /** Caller supplies a protocol-aware census; unanswered host evidence must never become zero live terminals. */
  census: VshudTerminalCensus
  /** Bind census to its incumbent record; a changed locked record makes earlier counts unverifiable. */
  censusRecord?: VshudActivationRecord
  /** WSL only: the record and fence this connect read moments ago; skips the same pre-upload reads. */
  preRead?: { record: VshudActivationRecord; fenceOpen: boolean }
  /** WSL only: a same-version deploy skips its fence; the caller's wake re-checks under its own. */
  sameVersionFencedByCaller?: boolean
  /** Recount under fence just before stopping the same incumbent; uploads may outdate initial counts and failures stay unverifiable. */
  recountCensus: () => Promise<VshudTerminalCensus>
  /** Best-effort reopen when incumbent keeps serving; admission also expires server-side. */
  releaseIncumbentAdmission: () => Promise<void>
  force?: VshudUpdateForce
  /** The Vshu app version activating, recorded so an older client never downgrades the host. */
  appVersion?: string
  /** Reapply version policy under lock because peer activation/stop may land during upload. */
  admitRecord?: (record: VshudActivationRecord, candidateVersion: string) => string | null
  readinessTimeoutMs?: number
  /** WSL only; SSH hosts always re-hash the runtime (see `installVshudBundle`). */
  recordedNodeRuntimeProbe?: boolean
  /** WSL only: bounded Node runtime downloads; SSH keeps the default timing. */
  nodeRuntimeDownload?: NodeRuntimeDownloadBudget
  /** WSL only: the host is a distro on this machine (see `installVshudBundle`). */
  localWslHost?: boolean
  /** Another install holds this version's lock; lets the UI say what the connect waits for. */
  onInstallLockWait?: (wait: InstallLockWait | null) => void
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

export type VshudDeployResult =
  | { outcome: 'installed-and-activated'; fullVersion: string; verdict: VshudActivationVerdict }
  | { outcome: 'already-active'; fullVersion: string }
  | {
      outcome: 'installed-not-activated'
      fullVersion: string
      code: string
      reason: string
      /** The candidate's own preflight or launch check failed; a deferral never sets this. */
      startCheckFailed?: true
      /** This deploy uploaded the slot rather than finding it already installed. */
      freshlyInstalled?: true
    }

export async function deployVshud(
  input: VshudDeployOptions,
  retryClearedFence = true
): Promise<VshudDeployResult> {
  const target =
    input.target ??
    (input.localVshudDir
      ? readVshudBundleTarget(input.localVshudDir)
      : await resolveVshudRuntimeTarget(input))
  const runtimeCacheRoot =
    input.runtimeCacheRoot ?? join(getAppEnvironment().getPath('userData'), 'vshud-artifacts')
  const options = {
    ...input,
    target,
    readinessTimeoutMs: resolveVshudActivationReadinessTimeout(
      input.readinessTimeoutMs,
      VSHUD_STARTUP_READINESS_TIMEOUT_MS
    ),
    ...vshudNodeRuntimeInstallOptions(target, runtimeCacheRoot, input),
    localVshudDir:
      input.localVshudDir ?? (await materializeVshudArtifact(target, { signal: input.signal }))
  }
  const fullVersion = readLocalFullVersion(options.localVshudDir)
  const remoteDir = computeRemoteInstallDir(VSHUD_INSTALL_MODEL, options.remoteHome, fullVersion)
  const held = async (): Promise<VshudDeployResult> => {
    const { cleared, ...refusal } = await vshudActivationFenceRefusal(options, 'update')
    // Retry one cleared abandoned fence; repeated abandonment must surface to the caller.
    if (cleared && retryClearedFence) {
      return deployVshud(
        {
          ...input,
          preRead: undefined,
          sameVersionFencedByCaller: undefined,
          target,
          localVshudDir: options.localVshudDir
        },
        false
      )
    }
    return { outcome: 'installed-not-activated', fullVersion, ...refusal }
  }
  // Refuse before upload, then re-read both admission inputs under fence.
  const preUploadRecord = options.preRead?.record ?? (await readVshudActivationRecord(options))
  const censusRecord = options.censusRecord ?? preUploadRecord
  // An unanswered probe only skips this shortcut; lock acquisition still arbitrates.
  if (
    !options.preRead?.fenceOpen &&
    (await vshudActivationFenceExists(options).catch(() => false))
  ) {
    return held()
  }

  const installed = await installVshudBundle(options, fullVersion, remoteDir)
  if (options.sameVersionFencedByCaller && preUploadRecord.active === fullVersion) {
    return { outcome: 'already-active', fullVersion }
  }

  const result = await logVshudActivationOutcome(
    `update to ${fullVersion}`,
    () =>
      withVshudActivationLock(
        options,
        (lock) =>
          activateInstalledVshud({ ...options, censusRecord }, fullVersion, remoteDir, lock),
        held
      ),
    ['installed-and-activated', 'already-active']
  )
  return installed === 'uploaded' && result.outcome === 'installed-not-activated'
    ? { ...result, freshlyInstalled: true }
    : result
}
