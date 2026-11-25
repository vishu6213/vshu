import { BASH_CWD_REPORT_BLOCK } from '../../pty/shell-startup/shell-cwd-report'
import { getPosixOmpShellWrapper } from '../../pty/shell-startup/omp-shell-wrapper'
import { VSHU_CLI_POSIX_PATH_RESTORE } from '../../../shared/shell/launch/vshu-cli-shell-path'
import { MANAGED_DATA_ACCOUNT_POSIX_RESTORE } from '../../../shared/shell/launch/agents/managed-data-account-shell'
import { getPosixCodexShellLaunchPreflight } from '../../../shared/shell/launch/agents/codex-shell-function'
import { getPosixClaudeShellFunction } from '../../../shared/shell/launch/agents/claude-shell-function'
import { BASH_PROMPT_COMMAND_COMPOSITION_BLOCK } from '../../pty/shell-startup/bash-prompt-command-composition'
import {
  BASH_FEATURE_CHANNEL_BLOCK,
  SHELL_STARTUP_IDENTITY_MARKER_BLOCK
} from '../../pty/shell-startup/shell-templates'

export function getDaemonBashShellReadyRcfileContent(): string {
  return `# Vshu daemon bash shell-ready wrapper
${BASH_FEATURE_CHANNEL_BLOCK}
${SHELL_STARTUP_IDENTITY_MARKER_BLOCK}
# Consume the feature channel before profiles so child processes cannot inherit the selection.
__vshu_ready_marker=""
__vshu_has_feature ready && __vshu_ready_marker=1
unset _vshu_shell_features
unset -f __vshu_has_feature
# A system bashrc may already run ble.sh; it never exports this state, so exported copies are inherited.
for __vshu_ble_var in _ble_attached _ble_decode_bind_state; do
  [[ -n "\${!__vshu_ble_var+set}" ]] || continue
  case "$(declare -p "$__vshu_ble_var" 2>/dev/null)" in "declare -x"*) unset "$__vshu_ble_var" ;; esac
done
unset __vshu_ble_var
[[ -f /etc/profile ]] && source /etc/profile
if [[ -f "$HOME/.bash_profile" ]]; then
  source "$HOME/.bash_profile"
elif [[ -f "$HOME/.bash_login" ]]; then
  source "$HOME/.bash_login"
elif [[ -f "$HOME/.profile" ]]; then
  source "$HOME/.profile"
fi
# Force bracketed paste on older readline so multiline startup prompts remain one literal paste.
[[ $- == *i* ]] && bind 'set enable-bracketed-paste on' 2>/dev/null
__vshu_restore_agent_teams_path() {
  [[ -n "\${VSHU_AGENT_TEAMS_SHIM_DIR:-}" ]] || return 0
  case "$PATH" in
    "\${VSHU_AGENT_TEAMS_SHIM_DIR}"|"\${VSHU_AGENT_TEAMS_SHIM_DIR}:"*) return 0 ;;
  esac
  export PATH="\${VSHU_AGENT_TEAMS_SHIM_DIR}:$PATH"
}
__vshu_restore_agent_teams_path
${VSHU_CLI_POSIX_PATH_RESTORE}
# Restore the managed OpenCode config after user profiles may have replaced it.
[[ -n "\${VSHU_OPENCODE_CONFIG_DIR:-}" ]] && export OPENCODE_CONFIG_DIR="\${VSHU_OPENCODE_CONFIG_DIR}"
${MANAGED_DATA_ACCOUNT_POSIX_RESTORE}
[[ -n "\${VSHU_MIMOCODE_CONFIG_DIR:-}" ]] && export MIMOCODE_CONFIG_DIR="\${VSHU_MIMOCODE_CONFIG_DIR}"
${getPosixOmpShellWrapper()}
# Preserve the managed CODEX_HOME after user profiles.
[[ -n "\${VSHU_CODEX_HOME:-}" ]] && export CODEX_HOME="\${VSHU_CODEX_HOME}"
${getPosixCodexShellLaunchPreflight() + getPosixClaudeShellFunction()}
${BASH_CWD_REPORT_BLOCK}
# OSC 133 C/D clears stale agent status when a CLI exits without a stop hook.
__vshu_initializing_wrapper=1
__vshu_osc133_precmd() {
  local exit_code=$?
  __vshu_in_prompt_command=1
  __vshu_osc133_cwd_report
  if [[ -n "\${__vshu_in_command:-}" ]]; then
    printf "\\033]133;D;%s\\007" "$exit_code"
    unset __vshu_in_command
  fi
  printf "\\033]133;A\\007"
  return "$exit_code"
}
__vshu_osc133_preexec() {
  if [[ -n "\${__vshu_prompt_status_capture_command:-}" && "$BASH_COMMAND" == "$__vshu_prompt_status_capture_command" ]]; then
    unset __vshu_initial_prompt
    __vshu_in_legacy_prompt_wrapper=1
    return 0
  fi
  if [[ -n "\${__vshu_initializing_wrapper:-}\${__vshu_in_debug_capture:-}\${__vshu_initial_prompt:-}\${__vshu_in_prompt_dispatch:-}\${__vshu_in_legacy_prompt_wrapper:-}\${__vshu_in_prompt_command:-}" ]]; then
    [[ -z "\${__vshu_initializing_wrapper:-}\${__vshu_in_debug_capture:-}" ]] || return 0
    if [[ -n "\${__vshu_initial_prompt:-}" && "$BASH_COMMAND" == "__vshu_osc133_precmd" ]]; then
      unset __vshu_initial_prompt; return 0
    fi
    if [[ -n "\${__vshu_in_prompt_dispatch:-}" ]]; then
      [[ -n "\${__vshu_dispatching_user_prompt_command:-}" ]] || return 0
      if [[ "\${FUNCNAME[1]:-}" == "__vshu_run_prompt_command_array" ]]; then
        case "$BASH_COMMAND" in
          '(( __vshu_exit_code == 0 ))'|'__vshu_restore_prompt_status "$__vshu_exit_code"'|'eval "$__vshu_prompt_part"'|'eval "$__vshu_final_prompt_command"'|__vshu_dispatching_user_prompt_command=*|__vshu_osc133_precmd|__vshu_osc133_epilogue) return 0 ;;
        esac
      fi
    elif [[ "\${FUNCNAME[1]:-}" == "__vshu_run_prompt_command_array" || "$BASH_COMMAND" == "__vshu_run_prompt_command_array" ]]; then
      return 0
    fi
    [[ -z "\${__vshu_in_legacy_prompt_wrapper:-}" || -n "\${__vshu_dispatching_user_prompt_command:-}" ]] || return 0
    if [[ -n "\${__vshu_in_prompt_command:-}" && "$BASH_COMMAND" == "__vshu_in_debug_capture=1" ]]; then
      return 0
    fi
  fi
  case "\${FUNCNAME[1]:-}" in
    __vshu_osc133_*|__vshu_restore_prompt_status|__bp_*) return 0 ;;
  esac
  case "$BASH_COMMAND" in
    __vshu_osc133_precmd|__vshu_osc133_epilogue) return 0 ;;
    # The prefix is only special while bash-preexec prompt hooks run.
    __bp_*) [[ -n "\${__vshu_in_prompt_command:-}" ]] && return 0 ;;
  esac
  __vshu_run_user_debug_trap
  # Chain the framework trap captured before each prompt's lifecycle re-arm.
  if [[ -n "\${__vshu_chained_debug_trap:-}" ]]; then
    eval "$__vshu_chained_debug_trap" || true
  fi
  [[ -z "\${__vshu_in_prompt_command:-}" ]] || return 0
  # Emit C once per foreground command, excluding prompt hooks and repeated chained-trap calls.
  [[ -z "\${__vshu_in_command:-}" ]] || return 0
  printf "\\033]133;C\\007"
  __vshu_in_command=1
}
# Adopt the latest user trap before reclaiming lifecycle ownership.
__vshu_osc133_epilogue() {
  unset __vshu_in_prompt_command
  __vshu_adopt_outer_debug_trap
  trap '__vshu_osc133_preexec' DEBUG
  # Readline renders PS1 after entering raw mode; prompt hooks still run in cooked mode.
  if [[ -n "$__vshu_ready_marker" ]]; then
    # Attached ble.sh (0.3+) discards Bash's own prompt output and owns the TTY, so print directly.
    if [[ -n "\${_ble_attached-}" ]]; then
      # Its first render runs this before the key decoder attaches; wait for a later prompt.
      if [[ "\${_ble_decode_bind_state:-none}" != none ]]; then
        printf "\\033]777;vshu-shell-ready\\007"
        __vshu_ready_marker=""
      fi
    else
      PS1="\${PS1-}"'\\[\\e]777;vshu-shell-ready\\a\\]'
      __vshu_ready_marker=""
    fi
  fi
}
${BASH_PROMPT_COMMAND_COMPOSITION_BLOCK}
__vshu_prepend_prompt_command "__vshu_osc133_precmd"
__vshu_append_prompt_command '__vshu_in_debug_capture=1; __vshu_prompt_had_functrace=""; if [[ -o functrace ]]; then __vshu_prompt_had_functrace=1; set +T; fi; __vshu_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__vshu_prompt_had_functrace" ]] || set -T; unset __vshu_prompt_had_functrace __vshu_in_debug_capture'
__vshu_append_prompt_command "__vshu_osc133_epilogue"
__vshu_had_functrace=""
[[ -o functrace ]] && __vshu_had_functrace=1
set +T
__vshu_debug_trap_spec="$(trap -p DEBUG)"
[[ -z "$__vshu_had_functrace" ]] || set -T
if [[ -n "$__vshu_debug_trap_spec" && "$__vshu_debug_trap_spec" != "trap -- '__vshu_osc133_preexec' DEBUG" ]]; then
  __vshu_debug_trap_command="\${__vshu_debug_trap_spec#trap -- }"
  __vshu_debug_trap_command="\${__vshu_debug_trap_command% DEBUG}"
  eval "__vshu_user_debug_trap=$__vshu_debug_trap_command"
fi
unset __vshu_debug_trap_spec __vshu_debug_trap_command __vshu_had_functrace
unset -f __vshu_normalize_prompt_command_part __vshu_normalize_prompt_command __vshu_prepend_prompt_command __vshu_append_prompt_command
unset __vshu_prompt_command_normalized
# Arm DEBUG after setup so rcfile commands cannot emit a fake lifecycle before the first prompt.
__vshu_initial_prompt=1
trap '__vshu_osc133_preexec' DEBUG
unset __vshu_initializing_wrapper
`
}
