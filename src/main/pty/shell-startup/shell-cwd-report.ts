// Encode only on folder changes; re-send each prompt so a child shell's report cannot stick.
export const BASH_CWD_REPORT_BLOCK = `__vshu_osc133_cwd_report() {
  if [[ -n "\${MSYSTEM:-}" && -z "\${WSL_DISTRO_NAME:-}" ]]; then
    # Virtual MSYS mounts need a native path probe; never publish them as Windows root folders.
    case "$PWD" in /[A-Za-z]|/[A-Za-z]/*|//*) ;; *) return 0 ;; esac
  fi
  if [[ "$PWD" != "\${__vshu_cwd_reported-}" ]]; then
    __vshu_cwd_reported=$PWD
    local LC_ALL=C __vshu_e= __vshu_c __vshu_i
    for (( __vshu_i = 0; __vshu_i < \${#PWD}; __vshu_i++ )); do
      __vshu_c=\${PWD:__vshu_i:1}
      case $__vshu_c in
        [A-Za-z0-9/._~-]) __vshu_e+=$__vshu_c ;;
        *) builtin printf -v __vshu_c '%d' "'$__vshu_c"; builtin printf -v __vshu_c '%%%02X' $(( __vshu_c & 255 )); __vshu_e+=$__vshu_c ;;
      esac
    done
    if [[ -n "\${MSYSTEM:-}" && -z "\${WSL_DISTRO_NAME:-}" && "$__vshu_e" != //* ]]; then
      __vshu_e="/\${__vshu_e:1:1}:/\${__vshu_e:3}"
    fi
    __vshu_cwd_encoded=$__vshu_e
  fi
  builtin printf '\\033]7;file://localhost%s\\007' "\${__vshu_cwd_encoded-}"
}`

export const ZSH_CWD_REPORT_BLOCK = `__vshu_cwd_report() {
  builtin emulate -L zsh
  builtin setopt no_multibyte
  if [[ $PWD != \${__vshu_cwd_reported-} ]]; then
    builtin typeset -g __vshu_cwd_reported=$PWD
    local __vshu_e= __vshu_c __vshu_i
    for (( __vshu_i = 1; __vshu_i <= $#PWD; __vshu_i++ )); do
      __vshu_c=$PWD[__vshu_i]
      case $__vshu_c in
        ([A-Za-z0-9/._~-]) __vshu_e+=$__vshu_c ;;
        (*) builtin printf -v __vshu_c '%d' "'$__vshu_c"; builtin printf -v __vshu_c '%%%02X' $(( __vshu_c & 255 )); __vshu_e+=$__vshu_c ;;
      esac
    done
    builtin typeset -g __vshu_cwd_encoded=$__vshu_e
  fi
  builtin printf '\\033]7;file://localhost%s\\007' "\${__vshu_cwd_encoded-}"
}`
