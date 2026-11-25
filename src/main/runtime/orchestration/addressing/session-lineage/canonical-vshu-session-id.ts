import {
  isVshuSessionId,
  type VshuSessionId
} from '../../../../../shared/agent-session/identity/vshu-session-address'
import {
  clearedInto,
  readAgentSessionRecordStore,
  type AgentSessionRecordReader
} from './structured-session-lineage'

/** Address by the /clear root to preserve Runs and mail; without records, retain the supplied id. */
export function canonicalVshuSessionId(
  vshuSessionId: VshuSessionId,
  store: Pick<
    AgentSessionRecordReader,
    'listRecords' | 'lineageRevision'
  > | null = readAgentSessionRecordStore()
): VshuSessionId {
  return createCanonicalVshuSessionResolver(store)(vshuSessionId)
}

/** A chat row's Vshu session ID: its conversation's /clear root, from one lineage index. */
export function createChatVshuSessionIdResolver(
  store: Pick<
    AgentSessionRecordReader,
    'listRecords' | 'lineageRevision'
  > | null = readAgentSessionRecordStore()
): (sessionId: string) => string {
  const root = createCanonicalVshuSessionResolver(store)
  return (sessionId) => (isVshuSessionId(sessionId) ? root(sessionId) : sessionId)
}

/** Clear edges per lineage revision: mail checks ask per message, and must not rescan every record each time. */
const clearEdgesByRevision = new WeakMap<object, ReadonlyMap<string, string>>()

export function createCanonicalVshuSessionResolver(
  store: Pick<AgentSessionRecordReader, 'listRecords' | 'lineageRevision'> | null
): (id: VshuSessionId) => VshuSessionId {
  if (!store) {
    return (id) => id
  }
  const revision = store.lineageRevision?.()
  let clearedFrom = revision ? clearEdgesByRevision.get(revision) : undefined
  if (!clearedFrom) {
    const edges = new Map<string, string>()
    for (const record of store.listRecords()) {
      const next = clearedInto(record)
      if (next) {
        edges.set(next, record.sessionId)
      }
    }
    clearedFrom = edges
    if (revision) {
      clearEdgesByRevision.set(revision, edges)
    }
  }
  const edges = clearedFrom
  return (id) => canonicalVshuSessionFromEdges(id, edges)
}

export function canonicalVshuSessionFromEdges(
  vshuSessionId: VshuSessionId,
  clearedFrom: ReadonlyMap<string, string>
): VshuSessionId {
  // The visited set bounds corrupt chains; valid clear lineage is acyclic.
  let root: string = vshuSessionId
  const earlier = new Set([root])
  let prior = clearedFrom.get(root)
  while (prior && !earlier.has(prior)) {
    earlier.add(prior)
    root = prior
    prior = clearedFrom.get(root)
  }
  // Record ids are minted as Vshu session ids; one that is not cannot name the conversation.
  return isVshuSessionId(root) ? root : vshuSessionId
}
