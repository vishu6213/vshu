import { VSHU_AGENT_SESSION_ID_ENV } from '../../../../shared/agent-session/lifecycle/launch/agent-session-caller-env'
import { VSHU_STRUCTURED_SESSION_ENV } from '../../../../shared/agent-launch/environment/structured-session-marker'
import {
  VSHU_SCRUB_SAFE_LAUNCH_ENV,
  VSHU_SCRUB_SAFE_PANE_ENV
} from '../../../../shared/agent-hook-listener/transport/agent-hook-scrub-safe-env'

export const AGENT_HOOK_RUNTIME_ENV_KEYS = [
  'VSHU_AGENT_HOOK_PORT',
  'VSHU_AGENT_HOOK_TOKEN',
  'VSHU_AGENT_HOOK_ENV',
  'VSHU_AGENT_HOOK_VERSION',
  'VSHU_AGENT_HOOK_TRANSPORT',
  'VSHU_AGENT_HOOK_ENDPOINT',
  // Remove the reverted inherited path still present in older PTYs (#2778).
  'VSHU_CLAUDE_AGENT_STATUS_SETTINGS'
] as const

export const AGENT_PANE_HOOK_ENV_KEYS = [
  'VSHU_PANE_KEY',
  'VSHU_TAB_ID',
  'VSHU_WORKTREE_ID',
  'VSHU_AGENT_LAUNCH_TOKEN',
  VSHU_SCRUB_SAFE_PANE_ENV,
  VSHU_SCRUB_SAFE_LAUNCH_ENV,
  ...AGENT_HOOK_RUNTIME_ENV_KEYS
] as const

// Inherited structured-session IDs would make every pane claim the parent orchestration caller.
export const VSHU_AGENT_SESSION_CALLER_ENV_KEYS = [
  VSHU_AGENT_SESSION_ID_ENV,
  VSHU_STRUCTURED_SESSION_ENV
] as const
