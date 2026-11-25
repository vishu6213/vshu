import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'

export const PAIR_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['pair'],
    summary:
      'Pair a phone or another Vshu with the Vshu already running here, without restarting it',
    usage:
      'vshu pair [--mobile [--relay]] [--address <host>] [--grant-desktop-control] [--rotate] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'mobile',
      'relay',
      'address',
      'grant-desktop-control',
      'rotate'
    ],
    notes: [
      'Asks the Vshu running for this profile (desktop app, `vshu serve`, or its service) for a pairing offer. Nothing restarts and existing clients stay connected.',
      'Without --mobile it prints an access link for another Vshu (Settings → Remote Vshu Servers → Add Server). --mobile prints a QR code and link for Vshu Mobile.',
      '--address is the host or IP the client should dial, such as a Tailscale address. Without it Vshu picks this machine’s default LAN address.',
      'The first network pairing makes a loopback-only Vshu listen on every interface, as pairing from the desktop app does.',
      'Mobile pairing is LAN-only (same network or tailnet) unless --relay is given; Relay needs this host’s Vshu signed in (`vshu auth login`).',
      'An unused offer is reused until --rotate replaces it. After Vshu restarts it can’t be printed again, so a new one is made and the earlier link keeps working until --rotate. Clients that already paired keep their access.',
      "--grant-desktop-control lets Vshu drive this machine's desktop (vshu computer) for the paired Vshu. Off, Vshu won't do it for the client; anything with a terminal here can. It applies only to an access link, not to a phone.",
      'Paired clients and phones can’t create offers through Vshu, but anything with a terminal here can. Revoking a paired client also revokes links made from terminals it opened.'
    ],
    examples: [
      'vshu pair --mobile',
      'vshu pair --mobile --address 100.64.1.20',
      'vshu pair --address 100.64.1.20',
      'vshu pair --mobile --rotate --json'
    ]
  }
]
