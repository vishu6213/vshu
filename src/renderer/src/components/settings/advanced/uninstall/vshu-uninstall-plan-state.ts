import {
  VSHU_UNINSTALL_STEPS,
  type VshuUninstallAgentEntry,
  type VshuUninstallEntryState,
  type VshuUninstallHostEntry,
  type VshuUninstallPlan,
  type VshuUninstallRunStepArgs,
  type VshuUninstallStep
} from '../../../../../../shared/uninstall/vshu-uninstall-types'

export function isVshuUninstallProblem(state: VshuUninstallEntryState): boolean {
  return state === 'error' || state === 'needs-user'
}

export function getVshuUninstallStepStates(
  plan: VshuUninstallPlan,
  step: VshuUninstallStep
): VshuUninstallEntryState[] {
  switch (step) {
    case 'agent-hooks':
      return plan.agents.map((entry) => entry.state)
    case 'cli-command':
      return plan.cliCommand ? [plan.cliCommand.state] : []
    case 'background-service':
      return plan.backgroundService ? [plan.backgroundService.state] : []
    case 'hook-scripts':
      return plan.hookScripts ? [plan.hookScripts.state] : []
    case 'ssh-hosts':
      return plan.hosts.map((entry) => entry.state)
    case 'terminal-daemon':
      return plan.terminalDaemon ? [plan.terminalDaemon.state] : []
  }
}

export function countVshuUninstallProblems(plan: VshuUninstallPlan): number {
  return VSHU_UNINSTALL_STEPS.flatMap((step) => getVshuUninstallStepStates(plan, step)).filter(
    isVshuUninstallProblem
  ).length
}

/** Kept for a reason that can still clear (an agent that failed), not because another Vshu build uses it. */
export function countVshuUninstallPendingKept(plan: VshuUninstallPlan): number {
  if (plan.otherVshuBuildName) {
    return 0
  }
  return VSHU_UNINSTALL_STEPS.flatMap((step) => getVshuUninstallStepStates(plan, step)).filter(
    (state) => state === 'kept-shared'
  ).length
}

/** The scripts stay while any agent still runs them; once a retry clears the last agent they can go. */
export function shouldRemoveHookScriptsAfterAgentRetry(plan: VshuUninstallPlan): boolean {
  return (
    plan.otherVshuBuildName === null &&
    plan.hookScripts !== null &&
    plan.hookScripts.state !== 'removed' &&
    plan.agents.every((entry) => entry.state === 'removed' || entry.state === 'kept-shared')
  )
}

// An entry the step ran on but the returned plan no longer lists is gone from disk.
function mergeById<T extends { state: VshuUninstallEntryState }>(
  previous: T[],
  next: T[],
  idOf: (entry: T) => string,
  only: readonly string[] | undefined
): T[] {
  const nextById = new Map(next.map((entry) => [idOf(entry), entry]))
  return previous.map((entry) => {
    const id = idOf(entry)
    if (only && !only.includes(id)) {
      return entry
    }
    return nextById.get(id) ?? { ...entry, state: 'removed' }
  })
}

function mergeSimple<T extends { state: VshuUninstallEntryState }>(
  previous: T | null,
  next: T | null
): T | null {
  if (!previous) {
    return null
  }
  return next ?? { ...previous, state: 'removed' }
}

const agentId = (entry: VshuUninstallAgentEntry): string => entry.agent
const hostId = (entry: VshuUninstallHostEntry): string => entry.hostId

/** Takes only the entries the step ran on, so a backend rescan can't drop rows the user is reading. */
export function mergeVshuUninstallStepResult(
  previous: VshuUninstallPlan,
  next: VshuUninstallPlan,
  { step, only }: VshuUninstallRunStepArgs
): VshuUninstallPlan {
  switch (step) {
    case 'agent-hooks':
      return { ...previous, agents: mergeById(previous.agents, next.agents, agentId, only) }
    case 'cli-command':
      return { ...previous, cliCommand: mergeSimple(previous.cliCommand, next.cliCommand) }
    case 'background-service':
      return {
        ...previous,
        backgroundService: mergeSimple(previous.backgroundService, next.backgroundService)
      }
    case 'hook-scripts':
      return { ...previous, hookScripts: mergeSimple(previous.hookScripts, next.hookScripts) }
    case 'ssh-hosts':
      return { ...previous, hosts: mergeById(previous.hosts, next.hosts, hostId, only) }
    case 'terminal-daemon':
      return {
        ...previous,
        terminalDaemon: mergeSimple(previous.terminalDaemon, next.terminalDaemon)
      }
  }
}

export function markVshuUninstallStepFailed(
  plan: VshuUninstallPlan,
  { step, only }: VshuUninstallRunStepArgs,
  detail: string
): VshuUninstallPlan {
  const fail = <T extends { state: VshuUninstallEntryState; detail: string | null }>(
    entry: T
  ): T => ({ ...entry, state: 'error', detail })
  const failListed = <T extends { state: VshuUninstallEntryState; detail: string | null }>(
    entries: T[],
    idOf: (entry: T) => string
  ): T[] => entries.map((entry) => (only && !only.includes(idOf(entry)) ? entry : fail(entry)))
  switch (step) {
    case 'agent-hooks':
      return { ...plan, agents: failListed(plan.agents, agentId) }
    case 'cli-command':
      return { ...plan, cliCommand: plan.cliCommand && fail(plan.cliCommand) }
    case 'background-service':
      return { ...plan, backgroundService: plan.backgroundService && fail(plan.backgroundService) }
    case 'hook-scripts':
      return { ...plan, hookScripts: plan.hookScripts && fail(plan.hookScripts) }
    case 'ssh-hosts':
      return { ...plan, hosts: failListed(plan.hosts, hostId) }
    case 'terminal-daemon':
      return { ...plan, terminalDaemon: plan.terminalDaemon && fail(plan.terminalDaemon) }
  }
}

/** Runs one step and folds its result into the plan; a thrown step marks its own rows as errors. */
async function runVshuUninstallStep(
  plan: VshuUninstallPlan,
  args: VshuUninstallRunStepArgs,
  runStep: (args: VshuUninstallRunStepArgs) => Promise<VshuUninstallPlan>,
  failureDetail: string
): Promise<VshuUninstallPlan> {
  try {
    return mergeVshuUninstallStepResult(plan, await runStep(args), args)
  } catch (error) {
    console.error(`[uninstall] step ${args.step} failed:`, error)
    return markVshuUninstallStepFailed(plan, args, failureDetail)
  }
}

/** Runs every step the plan has entries for, in order; one failed step doesn't stop the rest. */
export async function runVshuUninstallSteps(
  initial: VshuUninstallPlan,
  runStep: (args: VshuUninstallRunStepArgs) => Promise<VshuUninstallPlan>,
  failureDetail: string,
  onProgress: (plan: VshuUninstallPlan, runningStep: VshuUninstallStep | null) => void
): Promise<VshuUninstallPlan> {
  let plan = initial
  for (const step of VSHU_UNINSTALL_STEPS) {
    if (getVshuUninstallStepStates(plan, step).length === 0) {
      continue
    }
    onProgress(plan, step)
    plan = await runVshuUninstallStep(plan, { step }, runStep, failureDetail)
  }
  onProgress(plan, null)
  return plan
}
