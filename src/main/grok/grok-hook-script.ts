import { posixCurlCommand } from '../agent-hooks/installation/scripts/hook-post-command'
import { getSharedManagedScriptPath } from '../agent-hooks/installation/scripts/managed-hook-script-path'
import { wrapPosixHookCommand } from '../agent-hooks/installation/commands/posix-hook-command'
import { wrapWindowsBatchHookCommand } from '../agent-hooks/installation/commands/windows-direct-cmd-hook-command'
import {
  buildPosixHookPayloadCapture,
  buildPosixHookSpoolLines,
  POSIX_HOOK_JSON_STDIN
} from '../agent-hooks/installation/scripts/hook-stdin-contract'
import {
  buildWindowsGrokHookScript,
  GROK_HOME_ENVELOPE_MAX_LENGTH
} from './windows-grok-hook-script'

export function getGrokManagedScriptFileName(): string {
  return process.platform === 'win32' ? 'grok-hook.cmd' : 'grok-hook.sh'
}

export function getGrokManagedScriptPath(): string {
  return getSharedManagedScriptPath(getGrokManagedScriptFileName())
}

export function getGrokManagedCommand(scriptPath: string): string {
  return process.platform === 'win32'
    ? wrapWindowsBatchHookCommand(scriptPath)
    : wrapPosixHookCommand(scriptPath)
}

export function getGrokManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return buildWindowsGrokHookScript()
  }

  return [
    '#!/bin/sh',
    ...buildPosixHookPayloadCapture('exit', POSIX_HOOK_JSON_STDIN),
    ...buildPosixHookSpoolLines('grok'),
    'if [ -n "$VSHU_AGENT_HOOK_ENDPOINT" ] && [ -r "$VSHU_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$VSHU_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$VSHU_AGENT_HOOK_PORT" ] || [ -z "$VSHU_AGENT_HOOK_TOKEN" ] || [ -z "$VSHU_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    'grok_home=',
    `if [ -n "\${GROK_HOME:-}" ] && [ "\${#GROK_HOME}" -le ${GROK_HOME_ENVELOPE_MAX_LENGTH} ]; then`,
    '  grok_home=$GROK_HOME',
    'fi',
    `printf '%s' "$payload" | ${posixCurlCommand()} -sS -X POST "http://127.0.0.1:\${VSHU_AGENT_HOOK_PORT}/hook/grok" \\`,
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Vshu-Agent-Hook-Token: ${VSHU_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${VSHU_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${VSHU_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${VSHU_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${VSHU_WORKTREE_ID}" \\',
    '  --data-urlencode "env=${VSHU_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${VSHU_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "grokHome=${grok_home}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || spool_hook_event',
    'exit 0',
    ''
  ].join('\n')
}
