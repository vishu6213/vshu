import { getLegacyOpenCodeEnvKeysToDelete } from '../../opencode/status-hooks/legacy-shared-config-dir'
import { restoreManagedDataAccountEnvironment } from '../../../shared/agent-launch/environment/managed-data-account-environment'
import { restoreOrStripOverlayEnv } from '../../../shared/agent-launch/startup/agent-overlay-env'
import { delimiter } from 'node:path'
import { dropInheritedVshuFishHistory } from '../../pty/history/fish-history-session'
import { removeAppImageRuntimeEnv } from '../../pty/shell-startup/appimage-terminal-env'
import { removeChromiumDisabledSessionBus } from '../../pty/shell-startup/chromium-session-bus-env'
import { stripInheritedBuildModeEnv } from '../../pty/shell-startup/build-mode-env'
import { stripPiProcessOwnerEnv } from '../../pty/shell-startup/pi-process-owner-env'
import { dropIncoherentCondaActivationEnv } from '../../pty/shell-startup/conda-activation-env'
import { stripLegacyTerminalShimEnv } from '../../pty/shell-startup/legacy-terminal-shim-dir'
import { removeInheritedNoColor } from '../../pty/shell-startup/terminal-color-env'
import { stampInheritedTmuxEnv } from '../../pty/shell-startup/inherited-tmux-env'
import { resolvePathEnvKey } from '../../pty/environment/windows-path-segment-merge'
import { dropInheritedVshuHistFile } from '../../pty/history/worktree-history-file-path'
import {
  gitCredentialPromptGuardEnv,
  mergeGitConfigEnvProtocol
} from '../../../shared/git/commands/git-credential-prompt-env'
import { TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV } from '../../../shared/shell/launch/terminal-git-credential-guard'
import { VSHU_IMAGE_PROTOCOL_ENV } from '../../../shared/terminal/images/terminal-image-protocol'
import {
  expandWindowsEnvironmentVariables,
  expandWindowsPathEnvironmentVariables
} from '../../../shared/shell/launch/windows-environment-expansion'
import { applyScrubSafeAgentEnvAliases } from '../../../shared/agent-hook-listener/transport/agent-hook-scrub-safe-env'
import type { TuiAgent } from '../../../shared/agent-launch/catalog/tui-agent'
import type { PtySubprocessOptions } from './pty-subprocess'
import { REMOTE_VIEWER_CLIPBOARD_ENV } from '../../../shared/clipboard/remote-viewer-clipboard-env'
import { VSHUD_SERVER_LAUNCH_ENV_KEYS } from '../../../shared/remote-runtime/serve-supervisor/vshud-server-launch-env'
import { stripInheritedAgentSessionEnv } from '../../../shared/agent-launch/startup/parent-agent-session-env'

const PANE_IDENTITY_ENV_KEYS = [
  'VSHU_PANE_KEY',
  'VSHU_TAB_ID',
  'VSHU_WORKTREE_ID',
  'VSHU_AGENT_LAUNCH_TOKEN',
  // Not identity but equally per-spawn: an inherited copy names another launch's CLI.
  'VSHU_WSL_CLI_DIR',
  'JCODE_RUNTIME_DIR',
  // Per-viewer: a Vshu started from a remote viewer's pane must not mark its own local panes.
  REMOTE_VIEWER_CLIPBOARD_ENV,
  // A server's own launch env; a user's `vshud` in this shell is not that server.
  ...VSHUD_SERVER_LAUNCH_ENV_KEYS
] as const
const WINDOWS_PATH_ENV_KEY_RE = /^path$/i

function composeGuardedDaemonGitConfigEnv(
  env: Record<string, string>,
  explicitEnv: Record<string, string> | undefined,
  launchAgent: TuiAgent | undefined
): void {
  const policy = explicitEnv?.[TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV]
  delete env[TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV]
  if (policy !== 'guard' && launchAgent === undefined) {
    return
  }
  // Apply the guard after the inherited-env merge so it reflects the pane's final askpass values.
  Object.assign(env, gitCredentialPromptGuardEnv(env, process.platform))
}

function deleteRequestedDaemonEnvKeys(
  env: Record<string, string>,
  keys: readonly string[] | undefined
): void {
  const userDataPath = process.env.VSHU_USER_DATA_PATH
  if (userDataPath) {
    for (const key of getLegacyOpenCodeEnvKeysToDelete(env, userDataPath, {})) {
      delete env[key]
    }
  }
  // Persistent daemon state may differ from Electron; remove CODEX_HOME only if its Vshu overlay owns it.
  const deleteVshuOwnedCodexHome =
    keys?.includes('VSHU_CODEX_HOME') === true &&
    env.VSHU_CODEX_HOME !== undefined &&
    env.CODEX_HOME === env.VSHU_CODEX_HOME
  // A merged caller config can supersede the daemon's recorded overlay source.
  if (
    keys?.includes('VSHU_OPENCODE_CONFIG_DIR') &&
    (env.OPENCODE_CONFIG_DIR === undefined ||
      env.OPENCODE_CONFIG_DIR === env.VSHU_OPENCODE_CONFIG_DIR)
  ) {
    restoreOrStripOverlayEnv(
      env,
      {
        primary: 'OPENCODE_CONFIG_DIR',
        overlay: 'VSHU_OPENCODE_CONFIG_DIR',
        source: 'VSHU_OPENCODE_SOURCE_CONFIG_DIR'
      },
      {}
    )
  }
  for (const key of keys ?? []) {
    delete env[key]
  }
  if (deleteVshuOwnedCodexHome) {
    delete env.CODEX_HOME
  }
}

function removeUnspecifiedPaneIdentityEnv(
  env: Record<string, string>,
  explicitEnv: Record<string, string> | undefined
): void {
  for (const key of PANE_IDENTITY_ENV_KEYS) {
    if (!explicitEnv || !Object.hasOwn(explicitEnv, key)) {
      delete env[key]
    }
  }
}

/** Removes the second PATH key only when the daemon's env merge created it. */
function collapseWindowsPathEnvKeys(
  env: Record<string, string>,
  requestedEnv: Record<string, string> | undefined
): void {
  if (process.platform !== 'win32') {
    return
  }
  const pathKeys = Object.keys(env).filter((key) => WINDOWS_PATH_ENV_KEY_RE.test(key))
  if (pathKeys.length < 2) {
    return
  }
  // A single explicit PATH spelling is authoritative; otherwise preserve inherited keys.
  const requestedKeys = requestedEnv
    ? Object.keys(requestedEnv).filter((key) => WINDOWS_PATH_ENV_KEY_RE.test(key))
    : []
  if (requestedKeys.length !== 1) {
    return
  }
  const survivingKey = requestedKeys[0]
  if (!survivingKey || env[survivingKey] === undefined) {
    return
  }
  for (const key of pathKeys) {
    if (key !== survivingKey) {
      delete env[key]
    }
  }
}

function promoteAgentTeamsShimPath(
  env: Record<string, string>,
  requestedPath: string | undefined
): void {
  if (!env.VSHU_AGENT_TEAMS_TEAM_ID || !requestedPath) {
    return
  }
  const normalizedRequestedPath =
    process.platform === 'win32'
      ? expandWindowsEnvironmentVariables(requestedPath, env)
      : requestedPath
  const pathDelimiter = process.platform === 'win32' ? ';' : delimiter
  const shimDir = normalizedRequestedPath.split(pathDelimiter)[0]
  if (!shimDir) {
    return
  }
  const pathKey = resolvePathEnvKey(env, process.platform)
  const currentParts = env[pathKey]?.split(pathDelimiter).filter(Boolean) ?? []
  env[pathKey] = [shimDir, ...currentParts.filter((part) => part !== shimDir)].join(pathDelimiter)
}

/** A dev receiver without an endpoint file must not fall back to another runtime's file. */
function removeInheritedDevAgentHookEndpoint(
  env: Record<string, string>,
  explicitEnv: Record<string, string> | undefined
): void {
  if (explicitEnv?.VSHU_AGENT_HOOK_ENV === 'development' && !explicitEnv.VSHU_AGENT_HOOK_ENDPOINT) {
    // Preserve explicit endpoints used by hooks that scrub token-like environment variables.
    delete env.VSHU_AGENT_HOOK_ENDPOINT
  }
}

/** A persistent daemon's inherited environment cannot supply ownership for a new pane. */
export function createDaemonPtyEnvironment(opts: PtySubprocessOptions): Record<string, string> {
  const inheritedEnv = stripInheritedBuildModeEnv(process.env)
  restoreManagedDataAccountEnvironment(inheritedEnv)
  const env: Record<string, string> = {
    ...mergeGitConfigEnvProtocol(inheritedEnv, opts.env),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Vshu',
    TERM_PROGRAM_VERSION: process.env.VSHU_APP_VERSION ?? '0.0.0-dev',
    FORCE_HYPERLINK: '1'
  } satisfies Record<string, string>
  if (opts.env?.[VSHU_IMAGE_PROTOCOL_ENV] === undefined) {
    delete env[VSHU_IMAGE_PROTOCOL_ENV]
  }
  stripLegacyTerminalShimEnv(env, process.platform)
  stripInheritedAgentSessionEnv(env, { launchEnv: opts.env, envToDelete: opts.envToDelete })
  composeGuardedDaemonGitConfigEnv(env, opts.env, opts.launchAgent)
  deleteRequestedDaemonEnvKeys(env, opts.envToDelete)
  if (opts.env?.TERM) {
    env.TERM = opts.env.TERM
  }
  removeUnspecifiedPaneIdentityEnv(env, opts.env)
  stampInheritedTmuxEnv(env, opts.env)
  stripPiProcessOwnerEnv(env)
  if (opts.env?.fish_history === undefined) {
    dropInheritedVshuFishHistory(env)
  }
  if (opts.env?.HISTFILE === undefined) {
    dropInheritedVshuHistFile(env)
  }
  if (opts.env?.VSHU_HISTFILE === undefined) {
    delete env.VSHU_HISTFILE
  }
  removeInheritedDevAgentHookEndpoint(env, opts.env)
  delete env.ELECTRON_RUN_AS_NODE
  removeAppImageRuntimeEnv(env)
  removeChromiumDisabledSessionBus(env)
  removeInheritedNoColor(env)
  // Mirror pane identity only after stripping, so aliases cannot retain removed ownership.
  applyScrubSafeAgentEnvAliases(env)
  env.LANG ??= 'en_US.UTF-8'
  return env
}

/** Platform launch preparation must not undo the caller's explicit environment deletions. */
export function rescrubDaemonPtyEnvironment(
  env: Record<string, string>,
  opts: PtySubprocessOptions
): void {
  deleteRequestedDaemonEnvKeys(env, opts.envToDelete)
  if (opts.env?.TERM) {
    env.TERM = opts.env.TERM
  }
}

/** Shell preparation can restore ambient state, so pane isolation is enforced again here. */
export function finalizeDaemonPtyEnvironment(
  env: Record<string, string>,
  requestedEnv: Record<string, string> | undefined,
  envToDelete?: readonly string[]
): void {
  stripInheritedAgentSessionEnv(env, { launchEnv: requestedEnv, envToDelete })
  expandWindowsPathEnvironmentVariables(env)
  collapseWindowsPathEnvKeys(env, requestedEnv)
  const requestedPath = requestedEnv
    ? requestedEnv[resolvePathEnvKey(requestedEnv, process.platform)]
    : undefined
  promoteAgentTeamsShimPath(env, requestedPath)
  stripLegacyTerminalShimEnv(env, process.platform)
  dropIncoherentCondaActivationEnv(env, process.platform)
  stripPiProcessOwnerEnv(env)
  // A live daemon pins this runtime across app updates; callers cannot name the host executable.
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'VSHU_AGENT_HOOK_NODE') {
      delete env[key]
    }
  }
  if (process.platform === 'win32') {
    env.VSHU_AGENT_HOOK_NODE = process.execPath
  }
}
