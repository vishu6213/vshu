import {
  VSHUD_NODE_RUNTIME_DIR_PREFIX,
  VSHUD_NODE_RUNTIME_POSIX_EXECUTABLE,
  VSHUD_RUNTIMES_DIRNAME
} from '../../../shared/remote-runtime/vshud-distribution/vshud-artifacts'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { RELAY_REMOTE_DIR } from './remote-install-root'
import { VSHUD_MACHINE_HOMES_DIRNAME } from '../host-state/vshud-machine-home'

/** POSIX shell glob words for vshud's pinned Node runtimes; machine homes may hold other architectures, so callers must self-test each match. */
export function vshudPosixNodeRuntimeGlobs(): [string, string] {
  const store = `${RELAY_REMOTE_DIR}/${VSHUD_RUNTIMES_DIRNAME}/${VSHUD_NODE_RUNTIME_DIR_PREFIX}`
  const executable = `/${VSHUD_NODE_RUNTIME_POSIX_EXECUTABLE}`
  const machineStores = `${RELAY_REMOTE_DIR}/${VSHUD_MACHINE_HOMES_DIRNAME}/`
  return [
    `"$HOME"/${quotePosixShell(store)}*${quotePosixShell(executable)}`,
    `"$HOME"/${quotePosixShell(machineStores)}*/${quotePosixShell(store)}*${quotePosixShell(executable)}`
  ]
}
