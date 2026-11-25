import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'

export const PORTS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['ports'],
    summary: 'List the listening ports Vshu detected for a workspace',
    usage: 'vshu ports [--worktree <selector>] [--all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'all'],
    notes: [
      'Defaults to the Vshu workspace that contains the current directory.',
      'Scans the host the workspace runs on and lists the ports Vshu tied to it, by process working directory (match=cwd) or command line (match=command).',
      '--all lists every listener found on that host, including other workspaces and processes Vshu could not tie to one. A native folder workspace needs --all, because Vshu does not tie ports to folders.',
      'url is the address the dev server printed in a Vshu terminal; it is missing when Vshu did not see one.'
    ],
    examples: [
      'vshu ports',
      'vshu ports --worktree branch:feature/login --json',
      'vshu ports --all',
      "vshu ports --json | jq -r '.result.ports[0].advertisedUrl'"
    ]
  }
]
