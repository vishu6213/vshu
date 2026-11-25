import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'

// Separate from `vshu account` (agent accounts): this is the host's own Vshu account.
export const AUTH_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['auth', 'login'],
    summary: "Sign this host's Vshu in to your Vshu account",
    usage: 'vshu auth login [--org <id|name>] [--switch] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'org', 'switch'],
    notes: [
      'Prints a link to open in any browser. After you sign in, the page shows a code; paste it back into this terminal only.',
      'The running Vshu on this host keeps the sign-in; this command never writes it. Start Vshu on this host first.',
      '--switch replaces an account that is already signed in. --org picks the organization when you belong to more than one.'
    ],
    examples: ['vshu auth login', 'vshu auth login --org Acme', 'vshu auth login --switch']
  },
  {
    path: ['auth', 'status'],
    summary: "Show which Vshu account this host's Vshu is signed in to",
    usage: 'vshu auth status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ['Exits 0 when signed in and 1 otherwise.'],
    examples: ['vshu auth status']
  },
  {
    path: ['auth', 'logout'],
    summary: "Sign this host's Vshu out of its Vshu account",
    usage: 'vshu auth logout [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['vshu auth logout']
  }
]
