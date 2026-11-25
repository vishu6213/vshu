import type { TuiAgent } from '../../agent-launch/catalog/tui-agent'

// Why: recognizing a manually started agent must not register an Vshu launcher.
export type TerminalAgent = TuiAgent | 'dsb'
