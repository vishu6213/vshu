import type { CommandSpec } from '../discovery/command-spec'
import { LOCAL_COMMAND_FLAGS } from '../arguments/args'

export const AGENT_HOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'hooks', 'prepare-codex'],
    summary: "Prepare a WSL pane's Vshu-managed Codex home before a shell launch",
    usage: 'vshu agent hooks prepare-codex',
    allowedFlags: [...LOCAL_COMMAND_FLAGS]
  },
  {
    path: ['agent', 'hooks', 'status'],
    summary: 'Show whether Vshu-managed agent status hooks are enabled',
    usage: 'vshu agent hooks status [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    examples: ['vshu agent hooks status', 'vshu agent hooks status --json']
  },
  {
    path: ['agent', 'hooks', 'off'],
    summary: 'Disable Vshu-managed agent status hooks and remove local hook entries',
    usage: 'vshu agent hooks off [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    examples: ['vshu agent hooks off']
  },
  {
    path: ['agent', 'hooks', 'on'],
    summary: 'Enable Vshu-managed agent status hooks',
    usage: 'vshu agent hooks on [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    examples: ['vshu agent hooks on']
  }
]
