import { posixCurlCommand } from '../agent-hooks/installation/scripts/hook-post-command'
import { buildWindowsAgentHookPostCommand } from '../agent-hooks/installation/commands/windows-agent-hook-post-command'
import { getSharedManagedScriptPath } from '../agent-hooks/installation/scripts/managed-hook-script-path'
import {
  buildPosixHookPayloadCapture,
  buildPosixHookSpoolLines,
  buildWindowsHookEnvironmentGuardLines
} from '../agent-hooks/installation/scripts/hook-stdin-contract'

export function getManagedScriptFileName(): string {
  return process.platform === 'win32' ? 'copilot-hook.cmd' : 'copilot-hook.sh'
}

export function getManagedScriptPath(): string {
  return getSharedManagedScriptPath(getManagedScriptFileName())
}

export function getManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      // Why: Copilot consumes stdout for some hooks, so answer before any guard can exit.
      'echo {}',
      // Why: the direct registration passes the event as %1; the encoded fallback sets the env var.
      'if not "%~1"=="" set "VSHU_COPILOT_HOOK_EVENT=%~1"',
      // Why: refresh endpoint coordinates for PTYs surviving an Vshu restart.
      'if defined VSHU_AGENT_HOOK_ENDPOINT if exist "%VSHU_AGENT_HOOK_ENDPOINT%" call "%VSHU_AGENT_HOOK_ENDPOINT%" 2>nul',
      ...buildWindowsHookEnvironmentGuardLines(),
      buildWindowsAgentHookPostCommand('copilot', [
        '  --data-urlencode "hookEventName=%VSHU_COPILOT_HOOK_EVENT%" ^'
      ]),
      'exit /b 0',
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    "printf '{}\\n'",
    ...buildPosixHookPayloadCapture(),
    ...buildPosixHookSpoolLines('copilot'),
    // Answer Copilot before endpoint refresh, stdin parsing or posting can fail.
    'if [ -n "$VSHU_AGENT_HOOK_ENDPOINT" ] && [ -r "$VSHU_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$VSHU_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$VSHU_AGENT_HOOK_PORT" ] || [ -z "$VSHU_AGENT_HOOK_TOKEN" ] || [ -z "$VSHU_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    // Keep large tool payloads off curl's command line to avoid EDR false positives.
    `printf '%s' "$payload" | ${posixCurlCommand()} -sS -X POST "http://127.0.0.1:\${VSHU_AGENT_HOOK_PORT}/hook/copilot" \\`,
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Vshu-Agent-Hook-Token: ${VSHU_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${VSHU_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${VSHU_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${VSHU_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${VSHU_WORKTREE_ID}" \\',
    '  --data-urlencode "hookEventName=${VSHU_COPILOT_HOOK_EVENT}" \\',
    '  --data-urlencode "env=${VSHU_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${VSHU_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || spool_hook_event',
    'exit 0',
    ''
  ].join('\n')
}
