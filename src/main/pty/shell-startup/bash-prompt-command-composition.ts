export const BASH_PROMPT_COMMAND_COMPOSITION_BLOCK = `__vshu_normalize_prompt_command_part() {
  local __vshu_value="$1" __vshu_output_name="$2" __vshu_character __vshu_chunk
  local __vshu_value_length=\${#1} __vshu_suffix_length=0 __vshu_backslash_length=0
  local __vshu_output_length __vshu_scan_start
  while (( __vshu_value_length - __vshu_suffix_length >= 1024 )); do
    __vshu_scan_start=$(( __vshu_value_length - __vshu_suffix_length - 1024 ))
    __vshu_chunk="\${__vshu_value:__vshu_scan_start:1024}"
    case "$__vshu_chunk" in
      *[!$' \\t\\n;']*) break ;;
      *) __vshu_suffix_length=$(( __vshu_suffix_length + 1024 )) ;;
    esac
  done
  while (( __vshu_suffix_length < __vshu_value_length )); do
    __vshu_character="\${__vshu_value: -__vshu_suffix_length - 1:1}"
    case "$__vshu_character" in
      ' '|$'\\t'|$'\\n'|';') __vshu_suffix_length=$(( __vshu_suffix_length + 1 )) ;;
      *) break ;;
    esac
  done
  __vshu_output_length=$(( \${#__vshu_value} - __vshu_suffix_length ))
  while (( __vshu_output_length - __vshu_backslash_length >= 1024 )); do
    __vshu_scan_start=$(( __vshu_output_length - __vshu_backslash_length - 1024 ))
    __vshu_chunk="\${__vshu_value:__vshu_scan_start:1024}"
    case "$__vshu_chunk" in
      *[!\\\\]*) break ;;
      *) __vshu_backslash_length=$(( __vshu_backslash_length + 1024 )) ;;
    esac
  done
  while (( __vshu_backslash_length < __vshu_output_length )); do
    __vshu_character="\${__vshu_value:__vshu_output_length - __vshu_backslash_length - 1:1}"
    [[ "$__vshu_character" == '\\' ]] || break
    __vshu_backslash_length=$(( __vshu_backslash_length + 1 ))
  done
  # Preserve the first separator when an odd backslash run escapes it.
  if (( __vshu_suffix_length > 0 && __vshu_backslash_length % 2 == 1 )); then
    __vshu_suffix_length=$(( __vshu_suffix_length - 1 ))
    __vshu_backslash_length=0
  fi
  __vshu_output_length=$(( \${#__vshu_value} - __vshu_suffix_length ))
  __vshu_value="\${__vshu_value:0:__vshu_output_length}"
  # Bash 4.4-5.0 scalar prompt evaluation preserves an odd terminal backslash.
  if (( __vshu_suffix_length == 0 && ((BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] == 0)) && __vshu_backslash_length % 2 == 1 )); then
    __vshu_value="$__vshu_value\\\\"
  fi
  printf -v "$__vshu_output_name" '%s' "$__vshu_value"
}
__vshu_restore_prompt_status() {
  return "$1"
}
__vshu_update_user_debug_trap() {
  local __vshu_debug_trap_spec="$1" __vshu_unchanged_debug_trap_spec="$2"
  local __vshu_debug_trap_command
  [[ "$__vshu_debug_trap_spec" != "$__vshu_unchanged_debug_trap_spec" ]] || return 0
  [[ "$__vshu_debug_trap_spec" != "trap -- '__vshu_osc133_preexec' DEBUG" ]] || return 0
  if [[ -z "$__vshu_debug_trap_spec" ]]; then
    __vshu_user_debug_trap=""
    unset __vshu_chained_debug_trap
    return 0
  fi
  __vshu_debug_trap_command="\${__vshu_debug_trap_spec#trap -- }"
  __vshu_debug_trap_command="\${__vshu_debug_trap_command% DEBUG}"
  eval "__vshu_user_debug_trap=$__vshu_debug_trap_command"
  unset __vshu_chained_debug_trap
}
__vshu_run_user_debug_trap() {
  if [[ -n "\${__vshu_user_debug_trap:-}" ]]; then
    eval "$__vshu_user_debug_trap" || true
  fi
}
__vshu_adopt_outer_debug_trap() {
  local __vshu_debug_trap_spec="\${__vshu_outer_debug_trap_spec:-}"
  unset __vshu_outer_debug_trap_spec
  __vshu_update_user_debug_trap "$__vshu_debug_trap_spec" "trap -- '__vshu_osc133_preexec' DEBUG"
}
__vshu_run_prompt_command_array() {
  local __vshu_exit_code="\${__vshu_prompt_status:-$?}" __vshu_prompt_part __vshu_prompt_index __vshu_user_count
  local __vshu_suffix_part
  local __vshu_final_prompt_command
  local __vshu_in_prompt_dispatch=1 __vshu_dispatching_user_prompt_command=""
  unset __vshu_prompt_status
  __vshu_adopt_outer_debug_trap
  trap '__vshu_osc133_preexec' DEBUG
  for __vshu_prompt_part in "\${__vshu_prompt_command_prefix[@]+"\${__vshu_prompt_command_prefix[@]}"}"; do
    if (( __vshu_exit_code == 0 )); then
      eval "$__vshu_prompt_part"
    else
      __vshu_restore_prompt_status "$__vshu_exit_code" || eval "$__vshu_prompt_part"
    fi
  done
  __vshu_user_count=0
  for __vshu_prompt_part in "\${__vshu_prompt_command_array[@]+"\${__vshu_prompt_command_array[@]}"}"; do
    __vshu_user_count=$(( __vshu_user_count + 1 ))
  done
  for (( __vshu_prompt_index = 0; __vshu_prompt_index + 1 < __vshu_user_count; __vshu_prompt_index++ )); do
    __vshu_prompt_part="\${__vshu_prompt_command_array[__vshu_prompt_index]}"
    __vshu_dispatching_user_prompt_command=1
    if (( __vshu_exit_code == 0 )); then
      eval "$__vshu_prompt_part"
    else
      __vshu_restore_prompt_status "$__vshu_exit_code" || eval "$__vshu_prompt_part"
    fi
    __vshu_dispatching_user_prompt_command=""
  done
  if (( __vshu_user_count > 0 )); then
    __vshu_prompt_part="\${__vshu_prompt_command_array[__vshu_user_count - 1]}"
    # Why: keep the final user hook and Vshu suffixes in one status-preserving eval.
    __vshu_final_prompt_command='eval "$__vshu_prompt_part"'
    for __vshu_suffix_part in "\${__vshu_prompt_command_suffix[@]+"\${__vshu_prompt_command_suffix[@]}"}"; do
      __vshu_final_prompt_command+=$'\\n'"$__vshu_suffix_part"
    done
    __vshu_dispatching_user_prompt_command=1
    if (( __vshu_exit_code == 0 )); then
      eval "$__vshu_final_prompt_command"
    else
      __vshu_restore_prompt_status "$__vshu_exit_code" || eval "$__vshu_final_prompt_command"
    fi
    __vshu_dispatching_user_prompt_command=""
  else
    for __vshu_prompt_part in "\${__vshu_prompt_command_suffix[@]+"\${__vshu_prompt_command_suffix[@]}"}"; do
      if (( __vshu_exit_code == 0 )); then
        eval "$__vshu_prompt_part"
      else
        __vshu_restore_prompt_status "$__vshu_exit_code" || eval "$__vshu_prompt_part"
      fi
    done
  fi
  return "$__vshu_exit_code"
}
__vshu_finish_legacy_prompt_dispatch() {
  local __vshu_suffix_part
  if [[ -n "\${__vshu_in_prompt_command:-}" ]]; then
    for __vshu_suffix_part in "\${__vshu_prompt_command_suffix[@]+"\${__vshu_prompt_command_suffix[@]}"}"; do
      eval "$__vshu_suffix_part"
    done
  fi
}
__vshu_normalize_prompt_command() {
  [[ -z "\${__vshu_prompt_command_normalized:-}" ]] || return 0
  local __vshu_prompt_part
  local -a __vshu_normalized=()
  for __vshu_prompt_part in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
    __vshu_normalize_prompt_command_part "$__vshu_prompt_part" __vshu_prompt_part
    [[ -n "$__vshu_prompt_part" ]] && __vshu_normalized+=("$__vshu_prompt_part")
  done
  __vshu_prompt_command_normalized=1
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("\${__vshu_normalized[@]+"\${__vshu_normalized[@]}"}")
  else
    __vshu_prompt_command_array=("\${__vshu_normalized[@]+"\${__vshu_normalized[@]}"}")
    __vshu_prompt_command_prefix=()
    __vshu_prompt_command_suffix=()
    unset PROMPT_COMMAND
    # Why: PID scope distinguishes legacy prompt dispatch from ordinary user command text.
    __vshu_prompt_status_variable="__vshu_prompt_status_$$"
    __vshu_prompt_status_capture_command="$__vshu_prompt_status_variable=\\$?"
    __vshu_prompt_status_value="\\\${$__vshu_prompt_status_variable}"
    # Why: a changed DEBUG trap misses the capture command, and bash <= 4.3 reverts traps set in functions.
    PROMPT_COMMAND="$__vshu_prompt_status_capture_command; __vshu_in_legacy_prompt_wrapper=1; __vshu_prompt_status=$__vshu_prompt_status_value"'; __vshu_prompt_had_functrace=""; if [[ -o functrace ]]; then __vshu_prompt_had_functrace=1; set +T; fi; __vshu_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__vshu_prompt_had_functrace" ]] || set -T; unset __vshu_prompt_had_functrace; __vshu_run_prompt_command_array; __vshu_finish_legacy_prompt_dispatch; trap __vshu_osc133_preexec DEBUG; unset __vshu_in_legacy_prompt_wrapper'
  fi
}
__vshu_prepend_prompt_command() {
  local command="$1"
  __vshu_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("$command" "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}")
  else
    __vshu_prompt_command_prefix=("$command" "\${__vshu_prompt_command_prefix[@]+"\${__vshu_prompt_command_prefix[@]}"}")
  fi
}
__vshu_append_prompt_command() {
  local command="$1"
  __vshu_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND+=("$command")
  else
    __vshu_prompt_command_suffix+=("$command")
  fi
}`
