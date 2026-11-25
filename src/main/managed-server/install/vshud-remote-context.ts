import type { NodeRuntimeTarget } from '../../../shared/node-runtime/node-runtime-pin'
import type { SshTarget } from '../../../shared/remote-runtime/ssh/ssh-types'
import type { VshudActivationRecord } from '../activation/vshud-activation-record'
import { readVshudActivationRecord } from '../activation/vshud-activation-record-store'
import { resolveVshudRuntimeTarget } from '../lifecycle/vshud-runtime-target'
import { LINUX_LIBC_FIRST_PROBE } from '../../node-runtime/linux-libc-probe'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import { prepareWindowsVshudHost } from '../host-state/vshud-windows-host-preparation'
import {
  isWslVshudHostTarget,
  type VshudHostTarget,
  type VshudHostTransport
} from './vshud-host-transport'
import {
  decideVshudMachineHome,
  vshudMachineDataRoot,
  vshudMachineHomeDir,
  vshudMachineHomeProbeCommand,
  vshudMachineOwnershipUnresolvedMessage,
  parseVshudMachineHomeProbe
} from '../host-state/vshud-machine-home'
import {
  vshudMachineClaimCommand,
  readVshudMachineClaimAnswer
} from '../host-state/vshud-machine-claim-command'
import { execVshudRemote, type VshudRemoteExecTarget } from './vshud-remote-runtime-control'
import { readRemoteHomeCommand } from '../../ssh/remote-exec/ssh-remote-commands'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  normalizeRemoteHome,
  validateRemoteHome,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import { detectRemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform-detection'
import { VshudHostUnsupportedError } from '../../vshud/diagnostics/vshud-host-unavailable'
import { rememberSshHostPlatform } from '../../ssh/remote-host/ssh-host-platform-memo'

/** Default SSH generic retains compatibility with lifecycle consumers requiring SSH-only fields. */
export type VshudRemoteContext<Target extends VshudHostTarget = SshTarget> = {
  activationRecord: VshudActivationRecord
  /** Select a compatible runtime when host glibc is below the default pin's floor. */
  serverTarget: NodeRuntimeTarget
  connection: VshudHostTransport
  host: RemoteHostPlatform
  /** Login or machine-specific home for shared-home isolation; userDataDir must follow the same owner. */
  remoteHome: string
  target: Target
  userDataDir: string
}

export async function resolveVshudRemoteContext<Target extends VshudHostTarget = SshTarget>(
  target: Target,
  connection: VshudHostTransport,
  signal?: AbortSignal,
  detectedHost?: RemoteHostPlatform,
  /**
   * Facts the caller already read on this host. `loginHome` serves only login-home placement;
   * `firstLibcProbeOutput` answers the libc probe's first command, whose fallbacks still run.
   */
  known: {
    loginHome?: string
    firstLibcProbeOutput?: string
    /** Replaces the plain activation record read; WSL reads its connect snapshot here. */
    readActivationRecord?: (
      target: VshudRemoteExecTarget & { remoteHome: string; userDataDir: string }
    ) => Promise<VshudActivationRecord>
  } = {}
): Promise<VshudRemoteContext<Target>> {
  const host = detectedHost ?? (await detectRemoteHostPlatform(connection, { signal }))
  if (!host) {
    throw new VshudHostUnsupportedError(
      isWslVshudHostTarget(target)
        ? 'Vshu’s server doesn’t support this WSL distro’s platform. Use an x64 or arm64 Linux distro.'
        : 'Vshu’s server doesn’t support this SSH host’s platform.'
    )
  }
  const remote = { conn: connection, host, signal }
  const { vshudHome: remoteHome, userDataDir } = await resolveVshudMachineHome(
    remote,
    !isWslVshudHostTarget(target),
    known.loginHome
  )
  let firstLibcProbeOutput = known.firstLibcProbeOutput
  const serverTarget = await resolveVshudRuntimeTarget({
    conn: connection,
    host,
    signal,
    ...(firstLibcProbeOutput === undefined
      ? {}
      : {
          exec: async (command: string) => {
            if (command === LINUX_LIBC_FIRST_PROBE && firstLibcProbeOutput !== undefined) {
              const output = firstLibcProbeOutput
              firstLibcProbeOutput = undefined
              return output
            }
            // The fallbacks run exactly as the default exec would.
            return execCommand(connection, command, { signal })
          }
        })
  })
  if (!isWslVshudHostTarget(target)) {
    rememberSshHostPlatform(target.id, host, serverTarget)
  }
  if (isWindowsRemoteHost(host)) {
    // Prepare pinned Node before even reading activation state on Windows.
    await prepareWindowsVshudHost({
      conn: connection,
      host,
      remoteHome,
      serverTarget,
      signal
    })
  }
  const activationRecord = await (known.readActivationRecord ?? readVshudActivationRecord)({
    ...remote,
    remoteHome,
    userDataDir
  })
  return {
    activationRecord,
    serverTarget,
    connection,
    host,
    remoteHome,
    target,
    userDataDir
  }
}

/** Resolve per-machine state for shared POSIX homes; Windows and WSL retain login-home placement. */
export async function resolveVshudMachineHome(
  remote: VshudRemoteExecTarget,
  keyByMachine: boolean,
  knownLoginHome?: string
): Promise<{ loginHome: string; vshudHome: string; userDataDir: string }> {
  const { host } = remote
  if (!keyByMachine || isWindowsRemoteHost(host)) {
    const loginHome = normalizeRemoteHome(
      knownLoginHome ?? (await execVshudRemote(remote, readRemoteHomeCommand(host))),
      host
    )
    if (!validateRemoteHome(loginHome, host)) {
      throw new Error(`Remote home is not a valid path: ${loginHome.slice(0, 100)}`)
    }
    return {
      loginHome,
      vshudHome: loginHome,
      userDataDir: joinRemotePath(host, loginHome, '.vshu')
    }
  }
  const probe = parseVshudMachineHomeProbe(
    await execVshudRemote(remote, vshudMachineHomeProbeCommand(host)),
    host
  )
  const { loginHome } = probe
  let decision = decideVshudMachineHome(probe, host)
  if (decision.kind === 'unresolved') {
    throw new Error(
      vshudMachineOwnershipUnresolvedMessage(
        decision.machineKey,
        probe.identity?.hostname ?? null,
        decision.cause
      )
    )
  }
  if (decision.kind === 'claim') {
    const won = readVshudMachineClaimAnswer(
      await execVshudRemote(remote, vshudMachineClaimCommand(host, loginHome, decision.machineKey))
    )
    if (won.state !== 'present') {
      throw new Error(won.message)
    }
    decision =
      won.machineKey === decision.machineKey
        ? { kind: 'login-home' }
        : { kind: 'machine-home', machineKey: decision.machineKey }
  }
  if (decision.kind === 'login-home') {
    return {
      loginHome,
      vshudHome: loginHome,
      userDataDir: joinRemotePath(host, loginHome, '.vshu')
    }
  }
  const vshudHome = vshudMachineHomeDir(host, loginHome, decision.machineKey)
  await execVshudRemote(remote, `umask 077; mkdir -p ${quotePosixShell(vshudHome)}`)
  return {
    loginHome,
    vshudHome,
    userDataDir: vshudMachineDataRoot(host, loginHome, decision.machineKey)
  }
}
