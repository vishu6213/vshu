// Whether a message in a bot's chat is one a person typed in Vshu, read from Vshu's own record of the
// send: never Vshu's own message (a continue after a restart or a usage limit), an agent's, an
// automation's or a connector delivery's.
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../shared/agent-session/journal/agent-session-journal-types'
import { agentJournalSubmissionKey } from '../../shared/agent-session/journal/agent-session-journal-item-key'

function sentByPerson(
  item: AgentJournalRenderItem,
  submissions: readonly AgentJournalSubmission[]
): boolean {
  const sent = submissions.find(
    (submission) =>
      agentJournalSubmissionKey(submission.clientMessageId) === item.itemId ||
      submission.providerItemId === item.itemId
  )
  // As the journal reads a personal send; Vshu's continues name no sender and come from the host.
  // A queued card handed over says nothing of who queued it here, so it fails safe.
  return (
    sent !== undefined &&
    sent.queuedMessageId === undefined &&
    (sent.source?.kind === 'user' || (sent.source === undefined && sent.origin === 'client'))
  )
}

/** A person typed it in Vshu: an automation's run or event, agent mail and deliveries are marked. */
export function typedInVshuByPerson(
  item: AgentJournalRenderItem,
  submissions: readonly AgentJournalSubmission[]
): boolean {
  const body = item.body
  return (
    body.kind === 'message' &&
    !body.from &&
    body.origin === undefined &&
    !body.asker &&
    !body.memorySource &&
    !body.automationRun &&
    // Sent by an agent through Vshu (its CLI stamps it): never a person, whatever its source says.
    body.typedBy?.by !== 'agent' &&
    sentByPerson(item, submissions)
  )
}

/** The owner typed it in Vshu: at the host's own window, or on a paired device the host found signed
 *  in to its own account. Anything Vshu can't place as the owner (no stamp, an account it couldn't
 *  compare, another account) is not. */
export function typedInVshuByOwner(
  item: AgentJournalRenderItem,
  submissions: readonly AgentJournalSubmission[]
): boolean {
  const typedBy = item.body.kind === 'message' ? item.body.typedBy : undefined
  return (
    (typedBy?.by === 'host' || (typedBy?.by === 'device' && typedBy.own === true)) &&
    typedInVshuByPerson(item, submissions)
  )
}
