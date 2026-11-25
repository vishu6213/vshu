import type { VshuSessionId } from '../../agent-session/identity/vshu-session-address'

/** PTY parties use terminal handle/pane, structured parties use Vshu session identity (vshu_session_id:<id>).
 * Structured workers also have handles/panes; ordinary chats do not. Build identity at lookup boundaries and pass it whole. */
export type OrchestrationPartyIdentity = Readonly<{
  /** Mailbox address the party sends from and reads: its terminal handle, else its session address. */
  address: string
  terminalHandle: string | null
  paneKey: string | null
  /** The bare Vshu session id the party is addressed by; mail spells it `vshu_session_id:<id>`. */
  vshuSessionId: VshuSessionId | null
}>
