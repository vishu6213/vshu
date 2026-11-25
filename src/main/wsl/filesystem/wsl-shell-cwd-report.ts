/**
 * A WSL bridge sh/dash/ash pane's ENV file (read once, by interactive shells only, after the login
 * profile). It first hands ENV back to the user's own value, so children see theirs, and sources it.
 * Then, inside WSL, it prefixes PS1 with the folder report; dash has no prompt hook, so the report
 * runs in a command substitution and re-encodes $PWD byte by byte every prompt. bash and busybox
 * ash (fancy prompt, on in Alpine's and Debian's builds) get it inside \\[ \\] so the invisible bytes
 * do not count toward the prompt's width; dash has no line editor to miscount, and would print \\[.
 */
export const SH_WSL_ENV_FILE = `# Vshu WSL bridge sh ENV: restore the user's ENV, then report the folder (OSC 7) at each prompt.
if [ -n "\${VSHU_WSL_USER_ENV:-}" ]; then
  ENV=$VSHU_WSL_USER_ENV
  unset VSHU_WSL_USER_ENV
  # The shell expands ENV's value before reading it; a here-document does the same without
  # parsing the user's quotes as shell syntax.
  eval "IFS= read -r __vshu_user_env <<__VSHU_USER_ENV_EOF
$ENV
__VSHU_USER_ENV_EOF
"
  if [ -r "$__vshu_user_env" ]; then
    . "$__vshu_user_env"
  fi
  unset __vshu_user_env
else
  unset ENV VSHU_WSL_USER_ENV
fi
if [ -n "\${WSL_DISTRO_NAME:-}" ]; then
  __vshu_wsl_cwd_report() {
    LC_ALL=C
    __vshu_p=$PWD
    __vshu_e=
    while [ -n "$__vshu_p" ]; do
      __vshu_r=\${__vshu_p#?}
      __vshu_c=\${__vshu_p%"$__vshu_r"}
      __vshu_p=$__vshu_r
      case $__vshu_c in
        [A-Za-z0-9/._~-]) __vshu_e=$__vshu_e$__vshu_c ;;
        *) __vshu_e=$__vshu_e$(printf '%%%02X' $(( $(printf '%d' "'$__vshu_c") & 255 ))) ;;
      esac
    done
    printf '\\033]7;file://%s\\007' "$__vshu_e"
  }
  case $PS1 in
    *__vshu_wsl_cwd_report*) ;;
    *)
      if [ -n "\${BASH_VERSION:-}" ] || [ -n "\${BB_ASH_VERSION:-}" ]; then
        PS1='\\[$(__vshu_wsl_cwd_report)\\]'"$PS1"
      else
        PS1='$(__vshu_wsl_cwd_report)'"$PS1"
      fi
      ;;
  esac
fi
`
