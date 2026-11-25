import { basename, win32 as pathWin32 } from 'node:path'

export const POSIX_SHELL_STARTUP_COMMAND_ENV = 'VSHU_POSIX_SHELL_STARTUP_COMMAND'

export function supportsPosixShellStartupCommand(shellPath: string): boolean {
  const shellName = pathWin32.basename(basename(shellPath)).toLowerCase()
  return shellName === 'bash' || shellName === 'zsh' || shellName === 'fish'
}

export function getBashStartupCommandPromptBlock(): string {
  return `if [[ \${${POSIX_SHELL_STARTUP_COMMAND_ENV}+present} == present ]]; then
  __vshu_remove_startup_command_prompt_hook() {
    local __vshu_item
    local -a __vshu_remaining=()
    if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
      for __vshu_item in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
        [[ "$__vshu_item" == "__vshu_run_startup_command" ]] || __vshu_remaining+=("$__vshu_item")
      done
      PROMPT_COMMAND=("\${__vshu_remaining[@]+"\${__vshu_remaining[@]}"}")
    else
      for __vshu_item in "\${__vshu_prompt_command_suffix[@]+"\${__vshu_prompt_command_suffix[@]}"}"; do
        [[ "$__vshu_item" == "__vshu_run_startup_command" ]] || __vshu_remaining+=("$__vshu_item")
      done
      __vshu_prompt_command_suffix=("\${__vshu_remaining[@]+"\${__vshu_remaining[@]}"}")
    fi
  }
  __vshu_run_startup_command() {
    local __vshu_command="$${POSIX_SHELL_STARTUP_COMMAND_ENV}" __vshu_status
    unset ${POSIX_SHELL_STARTUP_COMMAND_ENV}
    __vshu_remove_startup_command_prompt_hook
    unset -f __vshu_remove_startup_command_prompt_hook
    builtin history -s "$__vshu_command" 2>/dev/null || true
    builtin printf '%s\n' "$__vshu_command"
    eval "$__vshu_command"
    __vshu_status=$?
    unset -f __vshu_run_startup_command
    return "$__vshu_status"
  }
  __vshu_append_prompt_command "__vshu_run_startup_command"
fi`
}
