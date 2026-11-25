import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'

export const REPO_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['repo', 'list'],
    summary: 'List repos registered in Vshu',
    usage: 'vshu repo list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['repo', 'add'],
    summary: 'Add a project to Vshu by filesystem path',
    usage: 'vshu repo add --path <path> [--kind git|folder] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'kind'],
    notes: [
      'Defaults to git. Use --kind folder for an ordinary directory, including a parent of separate Git repositories; worktrees attached to a folder workspace appear in its Source Control panel, one section each.',
      'With --environment, --path must be an absolute path on that Vshu server.'
    ],
    examples: ['vshu repo add --path /abs/path/to/folder --kind folder --json']
  },
  {
    path: ['repo', 'show'],
    summary: 'Show one registered repo',
    usage: 'vshu repo show --repo <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo']
  },
  {
    path: ['repo', 'set'],
    summary: "Set a repo's non-Vshu worktree visibility or browser profile",
    usage:
      'vshu repo set --repo <selector> [--external-worktree-visibility show|hide|inherit] [--browser-profile <id>|inherit] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'external-worktree-visibility', 'browser-profile'],
    notes: [
      'show and hide override the global non-Vshu worktree visibility default for this repo; inherit clears the override.',
      'Per-worktree visibility rules still apply.',
      "--browser-profile picks the profile new browser tabs in this repo use, overriding the Browser setting's profile for new tabs; inherit clears it. Ids come from `vshu tab profile list`; `default` is the Default profile."
    ],
    examples: [
      'vshu repo set --repo path:/path/to/repo --external-worktree-visibility show --json',
      'vshu repo set --repo name:acme-web --browser-profile <profileId> --json'
    ]
  },
  {
    path: ['repo', 'hide'],
    summary: "Hide a project from Vshu's sidebar",
    usage: 'vshu repo hide --repo <selector> [--host <host>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'host'],
    notes: [
      'Only the view changes: open terminals, agents, automations and scripts keep running, and repo list still lists the repo with hiddenAt set.',
      "Hiding applies to one host's copy; with --host, it picks which copy of a repo set up on several hosts.",
      'On a paired Vshu server the flag lives on that server, so it hides the project for everyone connected to it.'
    ],
    examples: ['vshu repo hide --repo name:vshu --json']
  },
  {
    path: ['repo', 'unhide'],
    summary: "Show a hidden project in Vshu's sidebar again",
    usage: 'vshu repo unhide --repo <selector> [--host <host>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'host'],
    notes: ["Shows one host's copy again; on a paired Vshu server, for everyone connected to it."]
  },
  {
    path: ['repo', 'set-base-ref'],
    summary: "Set the repo's default base ref for future worktrees",
    usage: 'vshu repo set-base-ref --repo <selector> --ref <ref> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'ref']
  },
  {
    path: ['repo', 'search-refs'],
    summary: 'Search branch/tag refs within a repo',
    usage: 'vshu repo search-refs --repo <selector> --query <text> [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'query', 'limit']
  }
]
