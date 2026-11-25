// Decorate logged errors with a bounded redacted host tail, never telemetry; missing host evidence preserves the original failure.
import { redactString } from '../../../shared/observability/redactor'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { VSHUD_LOG_FILENAME } from './vshud-remote-host-support'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/remote-host/ssh-remote-platform'
import {
  vshudWindowsSlotOpCommand,
  readVshudWindowsEncodedAnswer
} from './vshud-remote-windows-node'
import { VSHUD_WINDOWS_LOG_TAIL_MARKER } from '../host-state/vshud-windows-host-script'
import type { VshudRemoteExecTarget } from './vshud-remote-runtime-control'

export const VSHUD_LOG_TAIL_LINES = 40
export const VSHUD_LOG_TAIL_MAX_BYTES = 8 * 1024
// Error decoration must not add an unbounded delay.
const VSHUD_LOG_TAIL_TIMEOUT_MS = 10_000

export function vshudLogTailCommand(host: RemoteHostPlatform, slotDir: string): string {
  const log = joinRemotePath(host, slotDir, VSHUD_LOG_FILENAME)
  if (isWindowsRemoteHost(host)) {
    return vshudWindowsSlotOpCommand(host, slotDir, 'log-tail', [
      log,
      String(VSHUD_LOG_TAIL_MAX_BYTES)
    ])
  }
  return `tail -c ${VSHUD_LOG_TAIL_MAX_BYTES} ${quotePosixShell(log)} 2>/dev/null || true`
}

export function parseVshudLogTail(host: RemoteHostPlatform, output: string): string | null {
  const raw = isWindowsRemoteHost(host)
    ? (readVshudWindowsEncodedAnswer(output, VSHUD_WINDOWS_LOG_TAIL_MARKER) ?? '')
    : output
  const bounded = Buffer.from(raw, 'utf8').subarray(-VSHUD_LOG_TAIL_MAX_BYTES).toString('utf8')
  const lines = bounded.replace(/\s+$/u, '').split(/\r?\n/u).slice(-VSHUD_LOG_TAIL_LINES)
  const tail = redactString(lines.join('\n'))
  return tail.trim() ? tail : null
}

async function readVshudLogTail(
  target: VshudRemoteExecTarget,
  slotDir: string
): Promise<string | null> {
  try {
    // Observe cancellation failures without reusing the already-aborted request signal.
    const output = await execCommand(target.conn, vshudLogTailCommand(target.host, slotDir), {
      wrapCommand: target.host.commandDialect !== 'powershell',
      timeoutMs: VSHUD_LOG_TAIL_TIMEOUT_MS
    })
    return parseVshudLogTail(target.host, output)
  } catch (error) {
    console.warn('[ssh] Could not read the vshud.log tail:', error)
    return null
  }
}

export async function withVshudLogTail(
  target: VshudRemoteExecTarget,
  slotDir: string,
  message: string
): Promise<string> {
  const tail = await readVshudLogTail(target, slotDir)
  return tail ? `${message}\nLast lines of vshud.log:\n${tail}` : message
}
