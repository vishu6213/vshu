// How a command server's saved env reaches a WSL guest without touching argv or shell history:
// `vshu mcp env` (the Windows CLI, run over interop) prints it as NUL-separated KEY=VALUE pairs and
// an end record, and a guest-side bash wrapper reads them into its environment and execs the real
// command there. Both ends of the format live here.

/** The last record: a wrapper that never reads it got a partial or failed answer and runs nothing. */
export const MCP_ENV_END = 'VSHU_MCP_ENV_END'

/** `env` as `vshu mcp env` prints it. Saved values never hold NUL (the host list refuses one). */
export function encodeMcpEnvPairs(env: Readonly<Record<string, string>>): string {
  return [...Object.entries(env).map(([key, value]) => `${key}=${value}`), MCP_ENV_END]
    .map((record) => `${record}\0`)
    .join('')
}

/**
 * The guest wrapper, run as `bash -c <script> vshu-mcp-env <launcher> <id> <agent> <workspace>
 * <command> <args…>` (workspace empty for none). It has no single quote or newline, so every shell
 * and config format carries it as one literal string.
 */
export const MCP_ENV_WRAPPER_SCRIPT = [
  // The pairs are collected first and exported only after the end record, so a saved name that
  // matches one of the wrapper's own variables can't change how it reads the rest. The fetch reads
  // no stdin: that is the agent's request pipe, which belongs to the server it execs.
  // An inherited SHELLOPTS=xtrace would trace the saved values onto stderr.
  'set +x',
  '__vshu_l=$1 __vshu_i=$2 __vshu_a=$3 __vshu_w=$4',
  'shift 4',
  '__vshu_e=0 __vshu_pairs=()',
  `while IFS= read -r -d "" __vshu_p; do if [ "$__vshu_p" = ${MCP_ENV_END} ]; then __vshu_e=1; else __vshu_pairs+=("$__vshu_p"); fi; done < <("$__vshu_l" mcp env "$__vshu_i" --agent "$__vshu_a" \${__vshu_w:+--workspace "$__vshu_w"} </dev/null)`,
  '[ "$__vshu_e" = 1 ] || { echo "Vshu could not read this MCP server environment." >&2; exit 1; }',
  '[ "${#__vshu_pairs[@]}" = 0 ] || export "${__vshu_pairs[@]}"',
  'exec "$@"'
].join('; ')

/** The guest command that starts `server` with the env `vshu mcp env` reads from this Vshu. */
export function mcpEnvWrapperCommand(
  launch: { launcher: string; id: string; agent: string; workspaceId: string | null },
  server: { command: string; args: readonly string[] }
): { command: string; args: string[] } {
  return {
    command: 'bash',
    args: [
      '-c',
      MCP_ENV_WRAPPER_SCRIPT,
      'vshu-mcp-env',
      launch.launcher,
      launch.id,
      launch.agent,
      launch.workspaceId ?? '',
      server.command,
      ...server.args
    ]
  }
}
