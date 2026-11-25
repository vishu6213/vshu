/** Whether any process runs from an vshud slot: its server, or a terminal daemon a candidate spawned there, which outlives the candidate's stop. */
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { posixProcessArgsShellFunction } from '../../managed-server/install/vshud-remote-host-support'
import { isVshudInstallDirLive } from '../../managed-server/install/vshud-remote-gc'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import type { VshudSlotOptions } from '../../managed-server/activation/vshud-recovery-slot'

// Every shell running this probe carries it in argv, so the probe never counts itself.
const PROBE_MARKER = '__VSHU_SLOT_PROCESS_PROBE__'

/** Prints LIVE, DEAD or UNKNOWN; anything unreadable is UNKNOWN. */
export function wslVshudSlotProcessProbeCommand(
  host: RemoteHostPlatform,
  slotDir: string,
  userDataDir: string
): string {
  const slot = quotePosixShell(`${slotDir.replace(/\/+$/u, '')}/`)
  const daemonDir = quotePosixShell(joinRemotePath(host, userDataDir, 'daemon'))
  const inSlot =
    'grep -F -e "$vshud_slot" -e "$vshud_real/" | ' + `grep -vF -- ${PROBE_MARKER} | grep -q .`
  return [
    `vshud_slot=${slot}; vshud_ddir=${daemonDir}; : ${PROBE_MARKER};`,
    // Node realpaths its entry, so a daemon behind a symlinked home names the resolved slot.
    'vshud_real=$(cd "$vshud_slot" 2>/dev/null && pwd -P) && [ -n "$vshud_real" ] || { echo UNKNOWN; exit 0; };',
    posixProcessArgsShellFunction(),
    // A live daemon whose pid file names it must be identified, not skipped.
    'for vshud_df in "$vshud_ddir"/daemon-v*.pid; do [ -f "$vshud_df" ] || continue;',
    'vshud_dp=$(sed -n \'s/.*"pid":\\([0-9][0-9]*\\).*/\\1/p\' "$vshud_df" | head -n 1);',
    '[ -n "$vshud_dp" ] || continue; kill -0 "$vshud_dp" 2>/dev/null || continue;',
    'vshud_da=$(vshud_args "$vshud_dp") || { echo UNKNOWN; exit 0; };',
    `printf '%s\\n' "$vshud_da" | ${inSlot} && { echo LIVE; exit 0; };`,
    'done;',
    // Capture first so the filters below never list themselves.
    'if vshud_all=$(ps -ww -eo args= 2>/dev/null) && [ -n "$vshud_all" ]; then :;',
    'elif [ -r /proc/self/cmdline ]; then',
    'vshud_all=$(for vshud_p in /proc/[0-9]*; do tr "\\000" " " < "$vshud_p/cmdline" 2>/dev/null; echo; done);',
    'else echo UNKNOWN; exit 0; fi;',
    `if printf '%s\\n' "$vshud_all" | ${inSlot}; then echo LIVE; else echo DEAD; fi`
  ].join(' ')
}

/** True unless both the server's pid file and a process scan prove nothing runs from the slot. */
export async function isWslVshudSlotInUse(
  slot: VshudSlotOptions,
  slotDir: string
): Promise<boolean> {
  if (await isVshudInstallDirLive(slot, slotDir)) {
    return true
  }
  try {
    const answer = await execCommand(
      slot.conn,
      wslVshudSlotProcessProbeCommand(slot.host, slotDir, slot.userDataDir),
      { wrapCommand: true, signal: slot.signal }
    )
    return answer.trim().split('\n').at(-1)?.trim() !== 'DEAD'
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return true
  }
}
