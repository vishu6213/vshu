// The host records quit/update/crash on the cut-turn row for Continue. Unknown wire causes retain the row's words without a named cause.

export const AGENT_SESSION_VSHU_STOP_CAUSES = ['update', 'quit', 'crash'] as const
/** The row's presentation, so a client that re-words host rows it can't name passes it through. */
export const AGENT_SESSION_VSHU_STOP_PRESENTATION = 'vshu-stop'
export type AgentSessionVshuStopCause = (typeof AGENT_SESSION_VSHU_STOP_CAUSES)[number]
export type AgentSessionVshuStop = { cause: AgentSessionVshuStopCause }

export function isAgentSessionVshuStopCause(value: unknown): value is AgentSessionVshuStopCause {
  return AGENT_SESSION_VSHU_STOP_CAUSES.some((cause) => cause === value)
}

/** The stop a row states, when this build knows its cause. */
export function readAgentSessionVshuStop(value: unknown): AgentSessionVshuStop | undefined {
  const cause =
    typeof value === 'object' && value !== null && 'cause' in value ? value.cause : undefined
  return isAgentSessionVshuStopCause(cause) ? { cause } : undefined
}
