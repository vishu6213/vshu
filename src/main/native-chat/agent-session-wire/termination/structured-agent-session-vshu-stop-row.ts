import { agentSessionFailureFact } from '../../../../shared/agent-session/failures/agent-session-failure'
import {
  AGENT_SESSION_VSHU_STOP_PRESENTATION,
  isAgentSessionVshuStopCause
} from '../../../../shared/agent-session/lifecycle/stopping/agent-session-vshu-stop'
import type { AgentSessionResumeTrigger } from '../../../../shared/agent-session/lifecycle/resume/agent-session-resume-marker'
import {
  agentSessionFailureWords,
  type AgentSessionFailureWordsContext
} from '../../../../shared/agent-session/failures/agent-session-failure-words'
import { isRootAgentJournalItem } from '../../../../shared/agent-session/journal/agent-session-journal-producer'
import { readAgentJournalTurn } from '../../../../shared/agent-session/lifecycle/records/agent-session-turn-record'
import type { AgentJournalStatusItem } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import { vshuShutdownRowClientMessageId } from '../../../../shared/native-chat/transcript/continuation/native-chat-vshu-stop-cut'
import type { SqlAgentSessionJournal as AgentSessionJournal } from '../../agent-session-journal/journal-sql-store'
import type { StructuredAgentSessionLogger } from '../host/structured-agent-session-logger'

type VshuStopRowJournal = Pick<AgentSessionJournal, 'appendShutdownCut'>

/** Keep legacy stop wording/tone alongside the cause that newer clients render muted. */
export function vshuStopRowBody(
  context: AgentSessionFailureWordsContext | undefined,
  vshuEnd: unknown
): AgentJournalStatusItem {
  return {
    kind: 'status',
    ...agentSessionFailureWords(agentSessionFailureFact('providerExited'), {
      ...context,
      surface: 'row'
    }),
    tone: 'error',
    ...(isAgentSessionVshuStopCause(vshuEnd)
      ? { presentation: AGENT_SESSION_VSHU_STOP_PRESENTATION, vshuStop: { cause: vshuEnd } }
      : {})
  }
}

export async function runningRootTurnItemId(
  journal: Pick<AgentSessionJournal, 'reads'>
): Promise<string | null> {
  return (
    (await journal.reads.generation()).items.findLast(
      (item) => isRootAgentJournalItem(item) && readAgentJournalTurn(item.body)?.state === 'running'
    )?.itemId ?? null
  )
}

/** Explain quit-cut turns after settlement, excluding completed/personal stops; never block quit on failure. */
export async function recordStructuredAgentSessionShutdownCut(input: {
  journal: VshuStopRowJournal
  sessionId: string
  /** Stopped-child fence keys row identity. */
  fence: number
  /** Current lease fence, advanced beyond the stopped child. */
  rowFence: number
  generation: string
  turnItemId: string | null
  trigger: AgentSessionResumeTrigger
  failureTextContext?: AgentSessionFailureWordsContext
  logger: StructuredAgentSessionLogger
}): Promise<void> {
  try {
    const { turnItemId } = input
    if (turnItemId === null) {
      return
    }
    const clientMessageId = vshuShutdownRowClientMessageId(
      input.sessionId,
      input.fence,
      input.generation
    )
    await input.journal.appendShutdownCut({
      identity: { provider: 'vshu', clientMessageId },
      body: vshuStopRowBody(input.failureTextContext, input.trigger),
      fence: input.rowFence,
      turnItemId
    })
  } catch (error) {
    input.logger.warn('recording why a quit cut a reply failed', {
      scope: 'shutdown-cut-row',
      sessionId: input.sessionId,
      error
    })
  }
}
