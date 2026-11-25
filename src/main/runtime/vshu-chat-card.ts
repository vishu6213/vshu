import type { AgentJournalVshuCardItem } from '../../shared/agent-journal-vshu-card-items'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'

/** Writes one of Vshu's cards into a chat this host runs; never fails what it reports. */
export function appendVshuChatCard(
  sessionId: string,
  body: AgentJournalVshuCardItem,
  what: string
): void {
  const fail = (error: unknown) => console.warn(`[vshu-chat-card] ${what} failed`, error)
  try {
    const host = getStructuredAgentSessionHost()
    // Null for a session this host doesn't run, so a chat on another host never gets the card.
    const destination = host?.captureAgentStartDestination(sessionId)
    if (!host || !destination) {
      return
    }
    void destination
      .then((captured) => captured && host.appendAgentStart(captured, body, Date.now()))
      .catch(fail)
  } catch (error) {
    fail(error)
  }
}
