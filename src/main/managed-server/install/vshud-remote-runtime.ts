import {
  VSHUD_BUILD_TARGET_FILENAME,
  VSHUD_LAUNCHER_FILENAME,
  VSHUD_SERVER_ENTRY_FILENAME,
  VSHUD_NODE_RUNTIME_DIR_PREFIX,
  VSHUD_NODE_RUNTIME_MARKER_FILENAME,
  VSHUD_NODE_RUNTIME_POSIX_EXECUTABLE,
  VSHUD_RUNTIMES_DIRNAME,
  vshudBunRuntimeFilename
} from '../../../shared/remote-runtime/vshud-distribution/vshud-artifacts'
import { assertPosixVshudHost } from './vshud-remote-host-support'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'

// Assign the long slot path once to reduce command size on the wire.
function assignVshudSlot(directory: string): string {
  return `vshud_slot=${quotePosixShell(directory.replace(/\/+$/, ''))}; `
}

// Rollback must still accept legacy single-entry slots.
export function selectVshudSlotEntryCommand(host: RemoteHostPlatform, directory: string): string {
  assertPosixVshudHost(host)
  const server = `"$vshud_slot"/${quotePosixShell(VSHUD_SERVER_ENTRY_FILENAME)}`
  const launcher = `"$vshud_slot"/${quotePosixShell(VSHUD_LAUNCHER_FILENAME)}`
  return `${assignVshudSlot(directory)}if [ -f ${server} ]; then vshud_entry=${server}; else vshud_entry=${launcher}; fi`
}

/** Set $vshud_runtime or exit 78; callers decide what an absent marker means. */
export function vshudNodeSlotRuntimeCommand(host: RemoteHostPlatform, directory: string): string {
  assertPosixVshudHost(host)
  const nodeMarker = `"$vshud_slot"/${quotePosixShell(VSHUD_NODE_RUNTIME_MARKER_FILENAME)}`
  const nodeRuntimePrefix = `"\${vshud_slot%/*}"/${quotePosixShell(
    `${VSHUD_RUNTIMES_DIRNAME}/${VSHUD_NODE_RUNTIME_DIR_PREFIX}`
  )}`
  const nodeExecutable = quotePosixShell(`/${VSHUD_NODE_RUNTIME_POSIX_EXECUTABLE}`)
  return (
    `${assignVshudSlot(directory)}vshud_node_sha=$(cat ${nodeMarker}) || exit 78; ` +
    // The digest becomes a path segment; reject non-SHA256 values.
    // Leading ( keeps the case pattern parseable inside command substitution.
    'case "$vshud_node_sha" in ("" | *[!0-9a-f]*) exit 78;; esac; ' +
    '[ "${#vshud_node_sha}" -eq 64 ] || exit 78; ' +
    `vshud_runtime=${nodeRuntimePrefix}"$vshud_node_sha"${nodeExecutable}; ` +
    '[ -x "$vshud_runtime" ] || exit 78; '
  )
}

/** Keeps address space small under RLIMIT_AS: undici's WASM memory otherwise reserves 4-9 GiB (#37538).
 * Caps any WASM memory in vshud at 64 MiB. Pinned Node only: older host Node rejects the flag. */
const VSHUD_PINNED_NODE_FLAGS = '--disable-wasm-trap-handler --wasm-max-mem-pages=1024'

/** Also sets $vshud_runtime_flags. Legacy host Node fallback must never hide an incomplete Node or Bun slot. */
export function selectVshudSlotRuntimeCommand(
  host: RemoteHostPlatform,
  directory: string,
  legacyNodePath: string
): string {
  assertPosixVshudHost(host)
  const nodeMarker = quotePosixShell(
    joinRemotePath(host, directory, VSHUD_NODE_RUNTIME_MARKER_FILENAME)
  )
  const runtime = quotePosixShell(joinRemotePath(host, directory, vshudBunRuntimeFilename(host.os)))
  const target = quotePosixShell(joinRemotePath(host, directory, VSHUD_BUILD_TARGET_FILENAME))
  return (
    // One compound command: launch chains it with && after cd.
    `if [ -e ${nodeMarker} ]; then ${vshudNodeSlotRuntimeCommand(host, directory)}` +
    `vshud_runtime_flags=${quotePosixShell(VSHUD_PINNED_NODE_FLAGS)}; ` +
    `elif [ -e ${target} ] || [ -e ${runtime} ]; then ` +
    `[ -x ${runtime} ] || exit 78; vshud_runtime=${runtime}; vshud_runtime_flags=; ` +
    `else vshud_runtime=${quotePosixShell(legacyNodePath)}; vshud_runtime_flags=; fi`
  )
}
