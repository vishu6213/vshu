import { randomUUID } from 'node:crypto'
import { VSHUD_NODE_RUNTIME_IDENTITY } from '../../../shared/remote-runtime/vshud-distribution/vshud-node-runtime-identity'
import { VSHUD_NODE_RUNTIME_MARKER_FILENAME } from '../../../shared/remote-runtime/vshud-distribution/vshud-artifacts'
import {
  VSHUD_PROFILE_PREFLIGHT_FLAG,
  VSHUD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseVshudProfilePreflight,
  type VshudProfilePreflightResponse
} from '../../../shared/remote-runtime/vshud-distribution/vshud-profile-preflight'
import { assertPosixVshudHost } from './vshud-remote-host-support'
import {
  vshudWindowsNodeCommandLine,
  vshudWindowsSlotOpCommand,
  readVshudWindowsEncodedAnswer
} from './vshud-remote-windows-node'
import { readWindowsVshudSlotEntry } from './vshud-remote-launch-windows'
import { VSHUD_WINDOWS_RUNTIME_MARKER } from '../host-state/vshud-windows-host-script'
import { vshudNodeSlotRuntimeCommand, selectVshudSlotEntryCommand } from './vshud-remote-runtime'
import { execCommand, isSshCommandExitError } from '../../ssh/remote-exec/remote-exec-command'
import { SYSTEM_SSH_TRANSPORT_EXIT_CODE } from '../../ssh/system-transport/system-ssh-operation-lifecycle'
import { errorMessage } from '../../../shared/errors/error-message'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import type { VshudHostTransport } from './vshud-host-transport'

/** The preflight timed out or lost its channel before the host answered, so it proves nothing about the host. */
export class VshudPreflightUnansweredError extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause), { cause })
    this.name = 'VshudPreflightUnansweredError'
  }
}

export function vshudProfilePreflightCommand(
  host: RemoteHostPlatform,
  directory: string,
  nonce: string,
  probeDaemonsUnder?: string
): string {
  assertPosixVshudHost(host)
  // New candidates always use pinned Node; host Node fallback could mask an incomplete slot.
  const marker = quotePosixShell(
    joinRemotePath(host, directory, VSHUD_NODE_RUNTIME_MARKER_FILENAME)
  )
  const launch = [
    'VSHU_BACKGROUND_LAUNCH=1',
    '"$vshud_runtime"',
    '"$vshud_entry"',
    VSHUD_PROFILE_PREFLIGHT_FLAG,
    quotePosixShell(nonce),
    ...(probeDaemonsUnder === undefined ? [] : [quotePosixShell(probeDaemonsUnder)])
  ].join(' ')
  return `[ -e ${marker} ] || exit 78; ${vshudNodeSlotRuntimeCommand(host, directory)}${selectVshudSlotEntryCommand(host, directory)}; ${launch}`
}

/** Qualify the candidate; given the served data root, it also names the daemon generations alive there. */
export async function preflightInstalledVshud(options: {
  conn: VshudHostTransport
  host: RemoteHostPlatform
  remoteInstallDir: string
  probeDaemonsUnder?: string
  fullVersion: string
  signal?: AbortSignal
}): Promise<VshudProfilePreflightResponse> {
  const nonce = randomUUID()
  const command = isWindowsRemoteHost(options.host)
    ? await windowsVshudProfilePreflightCommand(options, nonce)
    : vshudProfilePreflightCommand(
        options.host,
        options.remoteInstallDir,
        nonce,
        options.probeDaemonsUnder
      )
  const output = await execPreflightCommand(options.conn, command, {
    signal: options.signal,
    timeoutMs: VSHUD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    wrapCommand: !isWindowsRemoteHost(options.host)
  })
  return parseVshudProfilePreflight(output, nonce, VSHUD_NODE_RUNTIME_IDENTITY, options.fullVersion)
}

async function execPreflightCommand(
  conn: VshudHostTransport,
  command: string,
  options: NonNullable<Parameters<typeof execCommand>[2]>
): Promise<string> {
  const systemSsh = conn.usesSystemSshTransport?.() === true
  try {
    return await execCommand(conn, command, options)
  } catch (error) {
    // Only the remote command's own exit is the host's answer; OpenSSH exits 255 for itself.
    const hostExited =
      isSshCommandExitError(error) &&
      !(systemSsh && error.exitCode === SYSTEM_SSH_TRANSPORT_EXIT_CODE)
    if (hostExited || options.signal?.aborted) {
      throw error
    }
    throw new VshudPreflightUnansweredError(error)
  }
}

// Windows uses plain argv; vshud opens no window and needs no background-launch environment.
async function windowsVshudProfilePreflightCommand(
  options: {
    conn: VshudHostTransport
    host: RemoteHostPlatform
    remoteInstallDir: string
    probeDaemonsUnder?: string
    signal?: AbortSignal
  },
  nonce: string
): Promise<string> {
  const { host, remoteInstallDir } = options
  const slotAnswer = await execPreflightCommand(
    options.conn,
    vshudWindowsSlotOpCommand(host, remoteInstallDir, 'slot-runtime', [remoteInstallDir]),
    { signal: options.signal, wrapCommand: false }
  )
  const runtime = readVshudWindowsEncodedAnswer(slotAnswer, VSHUD_WINDOWS_RUNTIME_MARKER)
  if (!runtime) {
    throw new Error('The Windows host did not name the runtime this vshud slot needs.')
  }
  return vshudWindowsNodeCommandLine(runtime, [
    readWindowsVshudSlotEntry(slotAnswer, host, remoteInstallDir),
    VSHUD_PROFILE_PREFLIGHT_FLAG,
    nonce,
    ...(options.probeDaemonsUnder === undefined ? [] : [options.probeDaemonsUnder])
  ])
}
