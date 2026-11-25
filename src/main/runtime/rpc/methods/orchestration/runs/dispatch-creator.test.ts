import { describe, expect, it, vi } from 'vitest'
import { formatVshuSessionAddress } from '../../../../../../shared/agent-session/identity/vshu-session-address'
import { testVshuSessionId } from '../../../../../../shared/agent-session/identity/vshu-session-address-test-fixture'
import type { VshuRuntimeService } from '../../../../vshu-runtime'
import { resolveDispatchCreator } from './dispatch-creator'

const SESSION = testVshuSessionId('4a1f6c2e-8b3d-4e7a-9c15-0d2b6e8f1a37')
const CALLER = {
  address: formatVshuSessionAddress(SESSION),
  terminalHandle: null,
  paneKey: null,
  vshuSessionId: SESSION,
  sessionId: SESSION,
  workspaceId: 'repo::/work'
}

function creatorWhen(conversationTurn: boolean) {
  const turnOf = vi.fn(() => conversationTurn)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: resolveDispatchCreator reads only the conversation seam for a session caller.
  const runtime = {
    getExternalConversationSeam: () => ({ conversationTurn: turnOf })
  } as unknown as VshuRuntimeService
  return { creator: resolveDispatchCreator(runtime, CALLER.address, CALLER), turnOf }
}

describe('a chat starting a worker', () => {
  it('records that its connector conversation woke the turn, and nothing for a turn begun in Vshu', () => {
    const asked = creatorWhen(true)
    expect(asked.creator).toEqual({
      kind: 'session',
      vshuSessionId: SESSION,
      turnSource: 'connector'
    })
    expect(asked.turnOf).toHaveBeenCalledWith(expect.anything(), SESSION)
    expect(creatorWhen(false).creator).toEqual({ kind: 'session', vshuSessionId: SESSION })
  })
})
