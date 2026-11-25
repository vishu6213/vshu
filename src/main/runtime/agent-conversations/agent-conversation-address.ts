import { VSHU_SESSION_ADDRESS_PREFIX } from '../../../shared/agent-session/identity/vshu-session-address-prefix'
import {
  isVshuSessionId,
  parseVshuSessionAddress,
  type VshuSessionId
} from '../../../shared/agent-session/identity/vshu-session-address'
import { isTerminalHandle } from '../../../shared/terminal/terminal-handle-prefix'
import type { AgentSessionConversationView } from '../../../shared/agent-session/lifecycle/leases/agent-session-conversation-view'
import { AGENT_CONVERSATION_REFUSAL_CODES as CODES } from '../../../shared/agent-conversations/agent-conversation-contracts'
import { lookupVshuAgentSession } from '../orchestration/mailbox/routing/structured-session-mail-address'
import {
  conversationRecordReader,
  readAgentSessionRecordStore,
  type AgentSessionRecordReader
} from '../orchestration/addressing/session-lineage/structured-session-lineage'
import { canonicalVshuSessionId } from '../orchestration/addressing/session-lineage/canonical-vshu-session-id'
import { agentHookServer } from '../../agent-hooks/server/agent-hook-server'
import type { AgentSessionRecordStore } from '../agent-session/records/agent-session-record-store'
import { AgentConversationRefusal } from './agent-conversation-refusal'
import { isReverseLookupUnavailable } from '../../agent-hooks/identity/agent-identity-worker-protocol'

export type ResolvedAgentConversation =
  | {
      kind: 'chat'
      /** The conversation's /clear root, the ID Copy Vshu Session ID copies. */
      vshuSessionId: VshuSessionId
      record: AgentSessionConversationView
      store: AgentSessionRecordReader
    }
  | { kind: 'terminal'; vshuSessionId: VshuSessionId }

/** One Vshu session ID to the conversation it names on this host: chats first, from the chat
 *  store alone, then this host's terminal agent ids. Resolution reads records only; it never
 *  needs, starts or wakes a running agent. */
export async function resolveAgentConversation(
  runtime: { openAgentSessionRecordStore(): Promise<AgentSessionRecordStore> },
  input: string
): Promise<ResolvedAgentConversation> {
  const text = input.trim()
  if (isTerminalHandle(text)) {
    throw new AgentConversationRefusal(
      CODES.terminalHandle,
      `${text} is a terminal handle, which changes when the terminal restarts. Use \`vshu terminal …\` for it, or the agent's \`vshu_session_id:\` from \`vshu agent list\`.`
    )
  }
  const id = vshuSessionIdOf(text)
  const store =
    readAgentSessionRecordStore() ??
    (await runtime
      .openAgentSessionRecordStore()
      .then(conversationRecordReader)
      .catch(() => null))
  // A provider's own id is matched as typed; only Vshu IDs are respelled.
  const asTyped = store ? lookupVshuAgentSession(store, text) : null
  if (asTyped?.kind === 'provider-id') {
    throw providerIdRefusal(text, [asTyped.vshuSessionId], store)
  }
  const found = store && id ? (id === text ? asTyped : lookupVshuAgentSession(store, id)) : null
  if (found?.kind === 'found' && store && id) {
    return {
      kind: 'chat',
      vshuSessionId: canonicalVshuSessionId(id, store),
      record: found.record,
      store
    }
  }
  if (id) {
    const known = await agentHookServer.isTerminalAgentId(id)
    if (known === true) {
      return { kind: 'terminal', vshuSessionId: id }
    }
    if (known === undefined) {
      throw new AgentConversationRefusal(
        CODES.unavailable,
        `Vshu can't look up terminal agent IDs right now, so it can't tell whether agent ${id} runs here. Try again in a moment.`
      )
    }
  }
  // A provider's own id (a bare UUID can also pass as an Vshu ID) gets the ID to use instead.
  const linked = text ? await agentHookServer.terminalAgentIdsOfProviderSession(text) : []
  if (linked === undefined) {
    throw new AgentConversationRefusal(
      CODES.unavailable,
      `Vshu can't look up agent IDs right now, so it can't tell whether ${text} names an agent here. Try again in a moment.`
    )
  }
  if (isReverseLookupUnavailable(linked)) {
    // Chat and terminal membership both missed, and this file can't convert provider ids: that
    // says nothing about whether the agent exists or where.
    throw new AgentConversationRefusal(
      CODES.unavailable,
      `Vshu can't tell what ${text} names: no agent here has that ID, and this identity file can't look up provider conversation ids in the current version. Copy the agent's ID with Copy Vshu Session ID, or find it with \`vshu agent list\`.`
    )
  }
  if (Array.isArray(linked) && linked.length > 0) {
    throw providerIdRefusal(text, linked, store)
  }
  throw id
    ? new AgentConversationRefusal(
        CODES.unknown,
        `No agent ${text} on this Vshu. If it runs on another host, run this there or add \`--environment <host>\`.`
      )
    : new AgentConversationRefusal(
        CODES.invalidId,
        `${text || 'That'} is not an Vshu session ID. Find agents' IDs with \`vshu agent list\`, or copy one with Copy Vshu Session ID.`
      )
}

/** The Vshu ID `text` spells: an `vshu_session_id:` address or a bare ID. Older IDs spell their
 *  UUID with underscores, so a hyphenated legacy `<agent>_<uuid>` is respelled to match. */
function vshuSessionIdOf(text: string): VshuSessionId | null {
  const bare = (
    text.startsWith(VSHU_SESSION_ADDRESS_PREFIX)
      ? text.slice(VSHU_SESSION_ADDRESS_PREFIX.length)
      : text
  ).replace(
    /_([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i,
    '_$1_$2_$3_$4_$5'
  )
  return text.startsWith(VSHU_SESSION_ADDRESS_PREFIX)
    ? parseVshuSessionAddress(`${VSHU_SESSION_ADDRESS_PREFIX}${bare}`)
    : isVshuSessionId(bare)
      ? bare
      : null
}

function providerIdRefusal(
  given: string,
  vshuSessionIds: readonly string[],
  store: AgentSessionRecordReader | null
): AgentConversationRefusal {
  const addresses = vshuSessionIds.map(
    (id) =>
      `${VSHU_SESSION_ADDRESS_PREFIX}${isVshuSessionId(id) ? canonicalVshuSessionId(id, store) : id}`
  )
  return new AgentConversationRefusal(
    CODES.providerId,
    `${given} is the agent's own conversation id, not its Vshu session ID. Address it as ${addresses.join(' or ')}.`
  )
}
