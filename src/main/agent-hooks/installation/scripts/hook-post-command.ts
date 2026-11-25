import type { AgentHookSource } from '../../../../shared/agent-hook-listener/transport/agent-hook-relay'
import { VSHU_HOOK_RAW_JSON_TRANSPORT } from '../../../../shared/agent-hook-listener/configuration/agent-hook-types'
import { AGENT_HOOK_METADATA_CACHE_DIR } from '../../../../shared/agent-hook-listener/transport/agent-hook-spool'

// Older curl needs C numeric parsing; keep the parent script's UTF-8 locale unchanged.
export function posixCurlCommand(curlCommand = 'curl'): string {
  return `LC_ALL= LC_NUMERIC=C ${curlCommand}`
}

const PACK_HOOK_METADATA = `printf '%s\\037%s\\037%s\\037%s\\037%s\\037%s' "$VSHU_PANE_KEY" "$VSHU_TAB_ID" "$VSHU_AGENT_LAUNCH_TOKEN" "$VSHU_WORKTREE_ID" "$VSHU_AGENT_HOOK_ENV" "$VSHU_AGENT_HOOK_VERSION" | base64 | tr -d '\\n'`

/** Defines `vshu_hook_pack_metadata`, which reuses a pane's packed header while every input matches. */
export function buildPosixHookMetadataCacheLines(): string[] {
  return [
    'vshu_hook_pack_metadata() {',
    // Length prefixes keep different inputs from forming the same key.
    '  vshu_hook_meta_key="${#VSHU_PANE_KEY}:$VSHU_PANE_KEY ${#VSHU_TAB_ID}:$VSHU_TAB_ID ${#VSHU_AGENT_LAUNCH_TOKEN}:$VSHU_AGENT_LAUNCH_TOKEN ${#VSHU_WORKTREE_ID}:$VSHU_WORKTREE_ID ${#VSHU_AGENT_HOOK_ENV}:$VSHU_AGENT_HOOK_ENV ${#VSHU_AGENT_HOOK_VERSION}:$VSHU_AGENT_HOOK_VERSION"',
    '  vshu_hook_meta_file=',
    // A stale variable must not create state for an absent Vshu installation.
    '  if [ -r "${VSHU_AGENT_HOOK_ENDPOINT:-}" ]; then',
    '    vshu_hook_meta_id=$VSHU_PANE_KEY',
    // Name it like the spool file, which may sit on a Windows drive under WSL.
    '    while :; do case "$vshu_hook_meta_id" in *[/:]*) vshu_hook_meta_id="${vshu_hook_meta_id%%[/:]*}_${vshu_hook_meta_id#*[/:]}" ;; *) break ;; esac; done',
    `    vshu_hook_meta_file="\${VSHU_AGENT_HOOK_ENDPOINT%/*}/${AGENT_HOOK_METADATA_CACHE_DIR}/pane-$vshu_hook_meta_id"`,
    '    vshu_hook_meta_line=',
    '    IFS= read -r vshu_hook_meta_line 2>/dev/null < "$vshu_hook_meta_file"',
    '    vshu_hook_metadata=${vshu_hook_meta_line%% *}',
    '    [ -z "$vshu_hook_metadata" ] || [ "${vshu_hook_meta_line#* }" != "$vshu_hook_meta_key" ] || return 0',
    '  fi',
    `  vshu_hook_metadata=$(${PACK_HOOK_METADATA}) && [ -n "$vshu_hook_metadata" ] || return 1`,
    '  [ -n "$vshu_hook_meta_file" ] || return 0',
    '  [ -d "${vshu_hook_meta_file%/*}" ] || mkdir -m 700 "${vshu_hook_meta_file%/*}" 2>/dev/null || return 0',
    // Rename so a concurrent event never reads half a line.
    `  printf '%s %s\\n' "$vshu_hook_metadata" "$vshu_hook_meta_key" 2>/dev/null > "$vshu_hook_meta_file.$$" && mv -f "$vshu_hook_meta_file.$$" "$vshu_hook_meta_file" 2>/dev/null`,
    '  return 0',
    '}'
  ]
}

type PosixAgentHookPostOptions = {
  curlCommand?: string
  indent?: string
  decisionHeaderVar?: string
  /** Take the header from `buildPosixHookMetadataCacheLines` instead of packing it every event. */
  cachedMetadata?: boolean
}

export function buildPosixAgentHookPostCommand(
  source: AgentHookSource,
  options: PosixAgentHookPostOptions = {}
): string[] {
  const curlCommand = posixCurlCommand(options.curlCommand ?? 'curl')
  const indent = options.indent ?? '  '
  // Only Claude's and Codex's scripts capture this; the host checks the attachment before trusting it.
  const tmux = source === 'claude' || source === 'codex'
  // Names the decision format the script prints; absent, Vshu never waits on plugins.
  const decision = options.decisionHeaderVar
    ? [`  ${indent}-H "X-Vshu-Hook-Decision: \${${options.decisionHeaderVar}:-}" \\`]
    : []
  const url = `"http://127.0.0.1:\${VSHU_AGENT_HOOK_PORT}/hook/${source}"`
  const packMetadata = options.cachedMetadata
    ? ['  vshu_hook_pack_metadata && \\']
    : [
        `  vshu_hook_metadata=$(${PACK_HOOK_METADATA}) && \\`,
        '  [ -n "$vshu_hook_metadata" ] && \\'
      ]
  return [
    `if [ "\${VSHU_AGENT_HOOK_TRANSPORT:-}" = "${VSHU_HOOK_RAW_JSON_TRANSPORT}" ] && command -v base64 >/dev/null 2>&1 && command -v tr >/dev/null 2>&1; then`,
    ...packMetadata,
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST ${url} \\`,
    `  ${indent}--connect-timeout "\${connect_timeout:-0.5}" --max-time "\${max_time:-1.5}" \\`,
    `  ${indent}--noproxy "127.0.0.1" \\`,
    `  ${indent}-H "Content-Type: application/json" \\`,
    `  ${indent}-H "X-Vshu-Agent-Hook-Token: \${VSHU_AGENT_HOOK_TOKEN}" \\`,
    `  ${indent}-H "X-Vshu-Agent-Hook-Meta-Encoding: base64" \\`,
    `  ${indent}-H "X-Vshu-Agent-Hook-Meta: \${vshu_hook_metadata}" \\`,
    `  ${indent}-H "X-Vshu-Agent-Process: \${vshu_agent_process:-}" \\`,
    ...(tmux ? [`  ${indent}-H "X-Vshu-Tmux-Pane: \${vshu_tmux_pane:-}" \\`] : []),
    ...decision,
    `  ${indent}--data-binary @-`,
    'else',
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST ${url} \\`,
    `  ${indent}--connect-timeout "\${connect_timeout:-0.5}" --max-time "\${max_time:-1.5}" \\`,
    `  ${indent}--noproxy "127.0.0.1" \\`,
    `  ${indent}-H "Content-Type: application/x-www-form-urlencoded" \\`,
    `  ${indent}-H "X-Vshu-Agent-Hook-Token: \${VSHU_AGENT_HOOK_TOKEN}" \\`,
    ...decision,
    `  ${indent}--data-urlencode "paneKey=\${VSHU_PANE_KEY}" \\`,
    `  ${indent}--data-urlencode "tabId=\${VSHU_TAB_ID}" \\`,
    `  ${indent}--data-urlencode "launchToken=\${VSHU_AGENT_LAUNCH_TOKEN}" \\`,
    `  ${indent}--data-urlencode "worktreeId=\${VSHU_WORKTREE_ID}" \\`,
    `  ${indent}--data-urlencode "env=\${VSHU_AGENT_HOOK_ENV}" \\`,
    `  ${indent}--data-urlencode "version=\${VSHU_AGENT_HOOK_VERSION}" \\`,
    `  ${indent}--data-urlencode "agentProcess=\${vshu_agent_process:-}" \\`,
    ...(tmux ? [`  ${indent}--data-urlencode "tmuxPane=\${vshu_tmux_pane:-}" \\`] : []),
    `  ${indent}--data-urlencode "payload@-"`,
    'fi'
  ]
}
