import { describe, expect, it } from 'vitest'
import { SharedToolProcessSession, sharedToolProcessCaller } from './shared-tool-process-callers'

const SEALED = {
  PATH: '/usr/bin',
  VSHU_AGENT_SESSION_ID: 'chat-a',
  VSHU_TERMINAL_HANDLE: 'structworker_a',
  VSHU_BOT_TOOLS_TOKEN: 'bot-a-secret',
  VSHU_STRUCTURED_SESSION: '1',
  VSHU_USER_DATA_PATH: '/vshu-data',
  VSHU_CLI_COMMAND: '/vshu-data/cli/bin/vshu',
  VSHU_ENVIRONMENT: ''
}

function launched() {
  const writes: Record<string, string | null>[] = []
  const withdrawn: string[] = []
  const session = SharedToolProcessSession.forLaunch(
    {
      sharedToolProcess: {
        publishSessionEnv: async ({ providerSessionId, values }) => {
          writes.push({ ...values })
          return async () => {
            withdrawn.push(providerSessionId)
          }
        }
      }
    },
    SEALED
  )!
  return { session, writes, withdrawn }
}

describe('SharedToolProcessSession', () => {
  it('gives tools only a token, which names its chat until the chat ends', async () => {
    const { session, writes, withdrawn } = launched()
    await session.publishFor({ link: { handle: { nativeId: 'hermes-1' } } })
    const tools = writes[0]
    // The shared process's own copy of any chat's identity is unset, and none reaches it.
    expect(tools).toMatchObject({
      VSHU_AGENT_SESSION_ID: null,
      VSHU_TERMINAL_HANDLE: null,
      VSHU_BOT_TOOLS_TOKEN: null,
      VSHU_STRUCTURED_SESSION: '1',
      VSHU_USER_DATA_PATH: '/vshu-data',
      VSHU_CLI_COMMAND: '/vshu-data/cli/bin/vshu',
      VSHU_ENVIRONMENT: ''
    })
    expect(Object.values(tools)).not.toContain('bot-a-secret')
    expect(tools.PATH).toBeUndefined()
    const token = tools.VSHU_AGENT_SESSION_TOOL_TOKEN!
    expect(sharedToolProcessCaller(token)).toEqual({
      VSHU_AGENT_SESSION_ID: 'chat-a',
      VSHU_TERMINAL_HANDLE: 'structworker_a',
      VSHU_BOT_TOOLS_TOKEN: 'bot-a-secret'
    })
    expect(sharedToolProcessCaller(`${token}x`)).toBeNull()

    session.end()
    expect(sharedToolProcessCaller(token)).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(withdrawn).toEqual(['hermes-1'])
  })

  it('withdraws a publish that lands after the chat ended', async () => {
    const { session, withdrawn } = launched()
    const publish = session.publishFor({ link: { handle: { nativeId: 'hermes-1' } } })
    session.end()
    await publish
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(withdrawn).toEqual(['hermes-1'])
  })
})
