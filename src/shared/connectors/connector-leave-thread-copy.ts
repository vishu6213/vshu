// What `vshu bot reply --leave-thread` tells the agent when Vshu refuses it; nothing changed in each.
export const LEAVE_THREAD_REFUSALS = {
  not_a_thread:
    "Nothing changed: this chat doesn't answer a Slack thread you follow (a DM, GitHub or Linear can't be left this way).",
  leave_refused_stale:
    "Nothing changed: no request is running in this thread's chat now, so there's nothing to leave from.",
  leave_refused_mixed:
    "Nothing changed: this turn includes a message that isn't from a person who can ask you, so it can't be used to leave. Ask them to say it again on its own.",
  leave_unavailable:
    "Nothing changed: this Vshu connection can't tell when someone @mentions you yet, so you couldn't be brought back. Tell them you're still in the thread.",
  thread_mute_not_saved:
    "Nothing changed: Vshu couldn't save that you left, so replies here still wake you. Say it didn't work."
} as const

/** The leave may or may not have taken: a wait ran out, or its save's outcome is unknown. */
export const LEAVE_THREAD_UNCONFIRMED =
  "Vshu couldn't confirm whether you left, so don't say you left or that you're still here: Vshu posts a confirmation in the thread if you did."

export type LeaveThreadRefusalCode = keyof typeof LEAVE_THREAD_REFUSALS
