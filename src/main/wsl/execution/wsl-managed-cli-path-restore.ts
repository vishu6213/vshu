/** Leads PATH with the managed WSL CLI after startup files ran; an unusable CLI only warns. */
export const WSL_MANAGED_CLI_PATH_RESTORE = `if [ -n "\${VSHU_WSL_CLI_DIR:-}" ]; then
  if [ -x "$VSHU_WSL_CLI_DIR/\${VSHU_CLI_COMMAND:-}" ]; then
    export PATH="$VSHU_WSL_CLI_DIR\${PATH:+:$PATH}"
  else
    printf 'Vshu CLI unavailable: cannot run %s. Check WSL Windows-drive mount options.\\n' "$VSHU_WSL_CLI_DIR/\${VSHU_CLI_COMMAND:-}" >&2
  fi
fi`
