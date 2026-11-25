import type { CommandSpec } from '../discovery/command-spec'
import { LOCAL_COMMAND_FLAGS } from '../arguments/args'

const SELECTOR_NOTE =
  '--environment names a managed Vshu server this machine deployed over SSH (see `vshu environment list`); it is a selector here, not a routing flag.'
const DESKTOP_NOTE =
  'Runs on this machine’s Vshu desktop app, the same action as Settings > Vshu on your SSH hosts. A runtime without the SSH registry (headless `vshu serve`) refuses it.'

export const MANAGED_SERVER_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['environment', 'status'],
    summary: 'Show a managed Vshu server’s active version, terminals and pending work',
    usage: 'vshu environment status --environment <selector> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment'],
    notes: [SELECTOR_NOTE, DESKTOP_NOTE],
    examples: ['vshu environment status --environment build-box']
  },
  {
    path: ['environment', 'update'],
    summary: 'Update a managed Vshu server to this build’s version',
    usage: 'vshu environment update --environment <selector> [--force [--yes]] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment', 'force', 'yes'],
    notes: [
      'Without --force, an update that would restart over running terminals is deferred and reported, not applied.',
      'When the server cannot count its terminals, --force alone still defers. --force --yes goes ahead only if no terminal daemon is running, and terminals the server runs itself end, the same as Update anyway in Settings > Vshu on your SSH hosts.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: ['vshu environment update --environment build-box']
  },
  {
    path: ['environment', 'rollback'],
    destructive: true,
    summary: 'Roll a managed Vshu server back to its previous version',
    usage: 'vshu environment rollback --environment <selector> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment'],
    notes: [SELECTOR_NOTE, DESKTOP_NOTE]
  },
  {
    path: ['environment', 'recover'],
    summary: 'Finish or undo a managed Vshu server’s interrupted update, rollback or stop',
    usage:
      'vshu environment recover --environment <selector> [--accept-changed-state --yes] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment', 'accept-changed-state', 'yes'],
    notes: [
      'When a rejected build changed profile state, recover refuses rather than restart the previous build over it. --accept-changed-state --yes restores the prelaunch snapshot instead, the same as Restore in Settings > Vshu on your SSH hosts; what the rejected build changed is discarded.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: [
      'vshu environment recover --environment build-box',
      'vshu environment recover --environment build-box --accept-changed-state --yes'
    ]
  },
  {
    path: ['environment', 'stop'],
    destructive: true,
    summary: 'Stop a managed Vshu server and unlink it from this machine (decommission)',
    usage: 'vshu environment stop --environment <selector> --yes [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment', 'yes'],
    notes: [
      'Stops vshud on the SSH host and, once the host proves it exited, removes the server from this machine and disconnects the host. Its terminals end. Connecting the host again sets up a new server. Requires --yes.',
      'If the host cannot prove vshud exited, the server stays linked and the refusal says why; nothing is removed on a guess. For a host that is gone for good, use `vshu environment forget`.',
      'If this server is the default host for new projects, choose another one first. `vshu environment cancel-stop` withdraws a stop vshud has not acted on yet.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: ['vshu environment stop --environment build-box --yes']
  },
  {
    path: ['environment', 'forget'],
    destructive: true,
    summary: 'Unlink a managed Vshu server whose SSH host is gone, without stopping it',
    usage: 'vshu environment forget --environment <selector> --yes [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment', 'yes'],
    notes: [
      'Removes the server from this machine without contacting its host, so the SSH host can then be removed. Use it when the host was deleted or can never be reached again. Requires --yes.',
      'Nothing on the host is stopped: if it comes back, vshud may still be running there.',
      'The SSH host is left disconnected, since no Vshu server serves it any more. Connecting it again (Connect in Vshu) sets its server up again, relinking one still running there.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: ['vshu environment forget --environment build-box --yes']
  },
  {
    path: ['environment', 'cancel-stop'],
    summary: 'Withdraw a managed Vshu server stop that vshud has not acted on yet',
    usage: 'vshu environment cancel-stop --environment <selector> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'environment'],
    notes: [SELECTOR_NOTE, DESKTOP_NOTE]
  }
]
