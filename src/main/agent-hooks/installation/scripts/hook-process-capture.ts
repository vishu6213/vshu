/** Capture before Vshu inserts its managed-script shell. */
export const HOOK_PARENT_CAPTURE = 'VSHU_HOOK_AGENT_PID="${PPID:-}"; export VSHU_HOOK_AGENT_PID; '

// Uncached, as no builtin tells a reused PID from its old process: Linux reads /proc, macOS runs only ps.
export function buildHookProcessCapture(): string[] {
  return [
    'vshu_agent_process= vshu_agent_pid="${VSHU_HOOK_AGENT_PID:-}"',
    // Field 2 after the command name is ppid; field 20 is the start time in clock ticks since boot.
    'vshu_agent_stat_fields() { vshu_agent_ppid=${2-}; vshu_agent_start=${20-}; }',
    '[ -z "${VSHU_PANE_KEY:-}" ] || case "$vshu_agent_pid" in ""|*[!0-9]*) ;; *)',
    '  if [ -r "/proc/$vshu_agent_pid/stat" ]; then',
    '    vshu_agent_stat= vshu_agent_line= vshu_agent_boot= vshu_agent_start= vshu_agent_ppid= vshu_agent_cmdline=',
    // Read to EOF: a command name may contain a newline, and the strip below takes the last ") ".
    '    while IFS= read -r vshu_agent_line || [ -n "$vshu_agent_line" ]; do vshu_agent_stat="$vshu_agent_stat$vshu_agent_line "; vshu_agent_line=; done 2>/dev/null < "/proc/$vshu_agent_pid/stat"',
    '    vshu_agent_stat_fields ${vshu_agent_stat##*) }',
    // agy runs hooks via `sh -c`; a shell that forks for it leaves $PPID on that short-lived wrapper.
    '    case "${vshu_agent_stat%%) *}" in *" (sh"|*" (dash"|*" (bash"|*" (zsh")',
    '      while IFS= read -r vshu_agent_line || [ -n "$vshu_agent_line" ]; do vshu_agent_cmdline="$vshu_agent_cmdline$vshu_agent_line "; vshu_agent_line=; done 2>/dev/null < "/proc/$vshu_agent_pid/cmdline"',
    '      case "$vshu_agent_cmdline" in *VSHU_HOOK_AGENT_PID=*)',
    '        case "$vshu_agent_ppid" in ""|0|1|*[!0-9]*) ;; *)',
    '          if [ -r "/proc/$vshu_agent_ppid/stat" ]; then',
    '            vshu_agent_pid=$vshu_agent_ppid vshu_agent_stat= vshu_agent_line= vshu_agent_start=',
    '            while IFS= read -r vshu_agent_line || [ -n "$vshu_agent_line" ]; do vshu_agent_stat="$vshu_agent_stat$vshu_agent_line "; vshu_agent_line=; done 2>/dev/null < "/proc/$vshu_agent_pid/stat"',
    '            vshu_agent_stat_fields ${vshu_agent_stat##*) }',
    '          fi ;; esac ;; esac ;; esac',
    '    IFS= read -r vshu_agent_boot 2>/dev/null < /proc/sys/kernel/random/boot_id',
    '    case "$vshu_agent_start" in ""|*[!0-9]*) ;; *)',
    '      [ -z "$vshu_agent_boot" ] || vshu_agent_process="{\\"pid\\":$vshu_agent_pid,\\"platform\\":\\"linux\\",\\"startTime\\":\\"$vshu_agent_boot:$vshu_agent_start\\"}" ;; esac',
    // Bash sets OSTYPE on macOS; other shells still ask uname.
    '  elif case "${OSTYPE-}" in darwin*) ;; *) [ "$(uname -s 2>/dev/null)" = Darwin ] ;; esac; then',
    '    vshu_agent_cmdline=$(exec /bin/ps -p "$vshu_agent_pid" -o ppid=,args= 2>/dev/null)',
    '    vshu_agent_cmdline=${vshu_agent_cmdline#"${vshu_agent_cmdline%%[! ]*}"}',
    '    vshu_agent_ppid=${vshu_agent_cmdline%% *}',
    '    vshu_agent_cmdline=${vshu_agent_cmdline#* }',
    '    vshu_agent_cmdline=${vshu_agent_cmdline#"${vshu_agent_cmdline%%[! ]*}"}',
    // Match the shell on argv[0] only: an agent's prompt in its args can quote this wrapper.
    '    case "${vshu_agent_cmdline%% *}" in sh|*/sh|dash|*/dash|bash|*/bash|zsh|*/zsh)',
    '      case "$vshu_agent_cmdline" in *VSHU_HOOK_AGENT_PID=*)',
    '        case "$vshu_agent_ppid" in ""|0|1|*[!0-9]*) ;; *) vshu_agent_pid=$vshu_agent_ppid ;; esac ;; esac ;; esac',
    // Match the host probe's timezone when comparing local-time lstart strings.
    '    vshu_agent_start=$(TZ=UTC0 LC_ALL=C exec /bin/ps -p "$vshu_agent_pid" -o lstart= 2>/dev/null)',
    '    vshu_agent_start=${vshu_agent_start#"${vshu_agent_start%%[! ]*}"}',
    '    vshu_agent_start=${vshu_agent_start%"${vshu_agent_start##*[! ]}"}',
    '    [ -z "$vshu_agent_start" ] || vshu_agent_process="{\\"pid\\":$vshu_agent_pid,\\"platform\\":\\"darwin\\",\\"startTime\\":\\"$vshu_agent_start\\"}"',
    '  fi ;;',
    'esac',
    ...buildHookTmuxPaneCapture()
  ]
}

/** A tmux pane's own server, socket and pane id: a hook from inside tmux names a conversation its
 *  server, not the Vshu pane, keeps alive; also a lookup hint for the host's attachment check. */
export function buildHookTmuxPaneCapture(): string[] {
  return [
    'vshu_tmux_pane=',
    'case "${TMUX_PANE:-}" in %[0-9]*) [ -z "${TMUX:-}" ] || vshu_tmux_pane="$TMUX_PANE ${TMUX%,*,*}" ;; esac',
    '[ "$vshu_tmux_pane" != "${VSHU_INHERITED_TMUX:-}" ] || vshu_tmux_pane='
  ]
}
