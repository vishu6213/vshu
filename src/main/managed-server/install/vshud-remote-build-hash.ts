import { VSHUD_LAUNCHER_FILENAME } from '../../../shared/remote-runtime/vshud-distribution/vshud-artifacts'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { execVshudRemote, type VshudRemoteExecTarget } from './vshud-remote-runtime-control'
import { vshudWindowsSlotOpCommand } from './vshud-remote-windows-node'
import { VSHUD_BUILD_HASH_MARKER as BUILD_HASH_MARKER } from '../host-state/vshud-windows-host-script'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'

export async function readRemoteVshudBuildHash(
  target: VshudRemoteExecTarget,
  remoteInstallDir: string
): Promise<string> {
  const output = await execVshudRemote(
    target,
    remoteVshudBuildHashCommand(target.host, remoteInstallDir)
  )
  const match = output.match(new RegExp(`${BUILD_HASH_MARKER}\\s+([a-fA-F0-9]{16})`, 'u'))
  if (!match?.[1]) {
    throw new Error('Could not verify the installed vshud build hash.')
  }
  return match[1].toLowerCase()
}

export function remoteVshudBuildHashCommand(
  host: RemoteHostPlatform,
  remoteInstallDir: string
): string {
  if (isWindowsRemoteHost(host)) {
    return vshudWindowsSlotOpCommand(host, remoteInstallDir, 'build-hash', [
      joinRemotePath(host, remoteInstallDir, VSHUD_LAUNCHER_FILENAME)
    ])
  }
  const path = quotePosixShell(joinRemotePath(host, remoteInstallDir, VSHUD_LAUNCHER_FILENAME))
  // GNU/BusyBox provide sha256sum, macOS shasum; both print the digest first.
  return [
    `[ -f ${path} ] && [ -r ${path} ] || exit 1;`,
    `vshu_hash=$(if command -v sha256sum >/dev/null 2>&1; then sha256sum ${path} | awk '{print $1}';`,
    `elif command -v shasum >/dev/null 2>&1; then shasum -a 256 ${path} | awk '{print $1}'; fi);`,
    `case "$vshu_hash" in [0-9a-fA-F][0-9a-fA-F]*) printf '%s %.16s\\n' ${quotePosixShell(BUILD_HASH_MARKER)} "$vshu_hash";; esac`
  ].join(' ')
}
