// Stock zshrc can replace line-init after user config clears the prompt-hook array.
export const ZSH_DEFERRED_LINE_INIT_BLOCK = `__vshu_deferred_line_init() {
  builtin emulate -L zsh
  if [[ "\${CONTEXT-}" != start ]]; then
    (( \${+widgets[__vshu_saved_line_init]} )) && zle __vshu_saved_line_init "$@"
    return 0
  fi
  (( \${+functions[__vshu_deferred_init]} )) || return 0
  local __vshu_direct_line_init=0
  [[ "\${widgets[zle-line-init]:-}" == user:__vshu_deferred_line_init ]] && __vshu_direct_line_init=1
  __vshu_deferred_init
  if (( __vshu_direct_line_init && \${+widgets[zle-line-init]} )); then
    zle zle-line-init "$@"
  elif [[ "\${widgets[zle-line-init]:-}" == user:__vshu_prompt_mark ]]; then
    local __vshu_prev_line_init_fn=""
    __vshu_prompt_mark "$@"
  fi
}
# Run after user prompt hooks without copying their function metadata.
__vshu_deferred_sched_init() {
  local __vshu_prompt_status=$?
  builtin emulate -L zsh
  (( \${+functions[__vshu_deferred_init]} )) && __vshu_deferred_init
  builtin unset __vshu_deferred_sched_armed
  (( \${+functions[__vshu_deferred_sched_init]} )) && builtin unfunction __vshu_deferred_sched_init
  return $__vshu_prompt_status
}
__vshu_arm_deferred_line_init() {
  builtin emulate -L zsh
  if [[ "\${widgets[zle-line-init]:-}" != user:__vshu_deferred_line_init ]]; then
    if (( \${+widgets[zle-line-init]} )); then
      zle -A zle-line-init __vshu_saved_line_init
    fi
    zle -N zle-line-init __vshu_deferred_line_init
  fi
  if (( ! $+__vshu_deferred_sched_armed )) && builtin zmodload -F zsh/sched b:sched 2>/dev/null; then
    builtin sched +0 __vshu_deferred_sched_init && builtin typeset -g __vshu_deferred_sched_armed=1
  fi
}`

// Restore the prior widget before the readiness hook captures it.
export const ZSH_DEFERRED_LINE_INIT_RETIRE_BLOCK = `  if (( \${+widgets[__vshu_saved_line_init]} )); then
    if [[ "\${widgets[zle-line-init]:-}" == user:__vshu_deferred_line_init ]]; then
      zle -A __vshu_saved_line_init zle-line-init
    fi
    zle -D __vshu_saved_line_init
  elif [[ "\${widgets[zle-line-init]:-}" == user:__vshu_deferred_line_init ]]; then
    zle -D zle-line-init
  fi`

// Why: plugins can copy a call to line-init into their own body; its guard makes it inert after startup.
export const ZSH_DEFERRED_LINE_INIT_CLEANUP_BLOCK = `  if (( ! $+__vshu_deferred_sched_armed && \${+functions[__vshu_deferred_sched_init]} )); then
    builtin unfunction __vshu_deferred_sched_init
  fi`
