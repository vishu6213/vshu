/** Only positive host evidence proves slot exit. Unanswered probes stay unverifiable and never authorize starting a second slot. */
import type { ServeReadiness } from '../../server/serve-readiness'
import type { VshudActivationExpectation } from './vshud-activation-gate'
import { VSHUD_INSTALL_MODEL } from '../install/remote-install-model'
import { computeRemoteInstallDir } from '../install/remote-versioned-install'
import { readRemoteVshudBuildHash } from '../install/vshud-remote-build-hash'
import {
  launchVshudSlotAndAwaitReadiness,
  VshudActiveReadinessError,
  probeActiveVshudReadiness
} from './vshud-active-readiness'
import {
  vshudLivenessProbeCommand,
  vshudLivenessProvenExited,
  parseVshudLiveness,
  type VshudLiveness
} from '../install/vshud-remote-launch'
import {
  parseVshudStopOutcome,
  stopVshudCommand,
  type VshudStopOutcome
} from '../install/vshud-remote-process-control'
import {
  execVshudRemote,
  type VshudRemoteExecTarget
} from '../install/vshud-remote-runtime-control'
import { vshudActivationTransactionRoot } from './vshud-activation-transaction'
import {
  initialVshudActivationAdmissionCommand,
  parseInitialVshudActivationAdmission
} from './vshud-initial-activation-admission'

export const VSHUD_SLOT_STOP_WAIT_SECONDS = 20

export type VshudSlotOptions = VshudRemoteExecTarget & {
  remoteHome: string
  /** Host Node for legacy slots only; a slot's own runtime marker wins. */
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  readinessTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

export type VshudSlotIdentity = { version: string; remoteDir: string; buildHash: string }

function expectation(identity: VshudSlotIdentity): VshudActivationExpectation {
  return { buildHash: identity.buildHash, fullVersion: identity.version }
}

export function vshudSlotDir(options: VshudSlotOptions, version: string): string {
  return computeRemoteInstallDir(VSHUD_INSTALL_MODEL, options.remoteHome, version)
}

/** Hash installed bytes so readiness must prove the same build. */
export async function resolveVshudSlotIdentity(
  options: VshudSlotOptions,
  version: string
): Promise<VshudSlotIdentity> {
  const remoteDir = vshudSlotDir(options, version)
  return { version, remoteDir, buildHash: await readRemoteVshudBuildHash(options, remoteDir) }
}

export function launchVshudSlot(
  options: VshudSlotOptions,
  identity: VshudSlotIdentity
): Promise<ServeReadiness> {
  return launchVshudSlotAndAwaitReadiness(
    options,
    {
      remoteInstallDir: identity.remoteDir,
      nodePath: options.nodePath,
      fullVersion: identity.version,
      userDataDir: options.userDataDir,
      bindHost: options.bindHost,
      port: options.port,
      // Every SSH launch is client-managed, so every one may idle out and be woken on connect.
      activationRoot: vshudActivationTransactionRoot(options.host, options.remoteHome)
    },
    expectation(identity)
  )
}

/** Proves the slot serves, starting it only on proven exit. */
export async function ensureVshudSlotServing(
  options: VshudSlotOptions,
  identity: VshudSlotIdentity
): Promise<ServeReadiness> {
  const liveness = parseVshudLiveness(
    await execVshudRemote(options, vshudLivenessProbeCommand(options.host, identity.remoteDir))
  )
  if (liveness === 'LIVE') {
    return probeActiveVshudReadiness(
      { ...options, remoteInstallDir: identity.remoteDir },
      expectation(identity)
    )
  }
  if (!vshudLivenessProvenExited(liveness)) {
    throw new VshudActiveReadinessError(
      'unverifiable',
      `vshud ${identity.version} process state is unverifiable.`
    )
  }
  return launchVshudSlot(options, identity)
}

/** `justLaunched` only for a slot this run started; otherwise the readiness PID must agree. */
export async function stopVshudSlot(
  options: VshudSlotOptions,
  remoteDir: string,
  justLaunched: boolean
): Promise<VshudStopOutcome> {
  return parseVshudStopOutcome(
    await execVshudRemote(
      options,
      stopVshudCommand(
        options.host,
        remoteDir,
        justLaunched
          ? { waitSeconds: VSHUD_SLOT_STOP_WAIT_SECONDS, justLaunched: true }
          : { waitSeconds: VSHUD_SLOT_STOP_WAIT_SECONDS, nodePath: options.nodePath }
      )
    )
  )
}

type VshudSlotQuiescence = 'exited' | 'other-slot-serving'

/** Prove candidate exit before replacing state and rule out another running slot, unless it already serves. Missing PID files prove nothing: SSH may drop after nohup but before $! is recorded, so inspect data-root ownership. */
export async function quiesceInterruptedVshudSlot(
  options: VshudSlotOptions,
  /** `null` when nothing was launched, so only `otherSlot` needs ruling out. */
  version: string | null,
  otherSlot: VshudSlotIdentity | null
): Promise<VshudSlotQuiescence> {
  const remoteDir = version === null ? null : vshudSlotDir(options, version)
  const stopped =
    remoteDir === null ? 'already-exited' : await stopVshudSlot(options, remoteDir, false)
  let exited = stopped === 'stopped' || stopped === 'already-exited'
  if ((stopped === 'unknown' || stopped === 'unconfirmed') && remoteDir !== null) {
    // No verified answer, e.g. the slot died before readiness; liveness decides.
    exited = vshudLivenessProvenExited(await slotLiveness(options, remoteDir))
  }
  if (otherSlot) {
    const other = await slotLiveness(options, otherSlot.remoteDir)
    if (other === 'LIVE' && (exited || stopped === 'no-pid')) {
      // The serving slot holds the instance lock, so a PID-less launch cannot own the state.
      await probeActiveVshudReadiness(
        { ...options, remoteInstallDir: otherSlot.remoteDir },
        expectation(otherSlot)
      )
      return 'other-slot-serving'
    }
    if (!vshudLivenessProvenExited(other)) {
      throw new VshudActiveReadinessError(
        'unverifiable',
        `vshud ${version ?? 'candidate'} (${stopped}) and ${otherSlot.version} (${other}) cannot both be ` +
          'ruled out as owners of the shared state; it was not replaced.'
      )
    }
  }
  if (!exited && stopped === 'no-pid' && remoteDir !== null) {
    const admission = parseInitialVshudActivationAdmission(
      await execVshudRemote(
        options,
        initialVshudActivationAdmissionCommand(
          options.host,
          options.userDataDir,
          remoteDir,
          options.nodePath
        )
      )
    )
    exited = admission.decision === 'proceed'
  }
  if (!exited) {
    throw new VshudActiveReadinessError(
      'unverifiable',
      `vshud ${version ?? 'candidate'} could not be confirmed stopped (${stopped}); replacing its state would be unsafe.`
    )
  }
  return 'exited'
}

export async function slotLiveness(
  options: VshudSlotOptions,
  remoteDir: string
): Promise<VshudLiveness> {
  return parseVshudLiveness(
    await execVshudRemote(options, vshudLivenessProbeCommand(options.host, remoteDir))
  )
}
