// Login profiles can rebuild PATH; re-add Vshu's CLI first and Vshu's own agent copies last.
export const VSHU_CLI_POSIX_PATH_RESTORE = `if [ -n "\${VSHU_CLI_BIN_DIR:-}" ]; then
  case "\${PATH:-}" in
    "$VSHU_CLI_BIN_DIR"|"$VSHU_CLI_BIN_DIR":*) ;;
    *) export PATH="$VSHU_CLI_BIN_DIR\${PATH:+:$PATH}" ;;
  esac
fi
if [ -n "\${VSHU_MANAGED_AGENT_PATH:-}" ]; then
  case ":\${PATH:-}:" in
    *":$VSHU_MANAGED_AGENT_PATH:"*) ;;
    *) export PATH="\${PATH:+$PATH:}$VSHU_MANAGED_AGENT_PATH" ;;
  esac
fi`
