import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'

const HOST_NOTE =
  'Runs on the Vshu that owns the repos: this computer by default, or a paired server with --environment or --pairing-code. Rules are set in Vshu settings; these commands never change them.'

export const WORKSPACE_CLEANUP_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['workspace', 'cleanup', 'preview'],
    summary: 'Show what the cleanup rules would remove now, and why the rest stay',
    usage: 'vshu workspace cleanup preview [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      HOST_NOTE,
      'Removes nothing. Text output hides workspaces no rule watches (main workspaces, folder projects, projects with cleanup off); --json prints every row the host returned.'
    ],
    examples: ['vshu workspace cleanup preview', 'vshu workspace cleanup preview --json']
  },
  {
    path: ['workspace', 'cleanup', 'run'],
    destructive: true,
    summary: 'Run the cleanup rules now and print what was removed, kept and failed',
    usage: 'vshu workspace cleanup run [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      HOST_NOTE,
      'Each workspace is checked again right before it is removed, and nothing is forced. If a run is already going, this waits for it and prints its result.',
      'With no rule on, nothing is removed.'
    ],
    examples: ['vshu workspace cleanup run', 'vshu workspace cleanup run --json']
  },
  {
    path: ['workspace', 'cleanup', 'report'],
    summary: 'Show the last cleanup runs and when the next one is due',
    usage: 'vshu workspace cleanup report [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [HOST_NOTE],
    examples: ['vshu workspace cleanup report', 'vshu workspace cleanup report --json']
  }
]
