import type { VshuRuntimeService } from '../../../vshu-runtime'
import type { StructuredSessionSurfaceRuntime } from '../../../agent-session/lifecycle/structured-agent-session-close'

export type WorkerTerminalReleaseRuntime = StructuredSessionSurfaceRuntime &
  Pick<
    VshuRuntimeService,
    | 'forgetStructuredSessionMail'
    | 'resolveOrchestrationWorkerServer'
    | 'callOrchestrationWorkerServer'
    | 'getOrchestrationFleetAgentStatusSnapshot'
    | 'getOrchestrationDb'
    | 'getExistingOrchestrationDb'
    | 'showTerminal'
    | 'resolveTerminalHandleByProcessIncarnation'
    | 'getTerminalPaneKey'
    | 'getTerminalHandleForPaneKey'
    | 'getTerminalProcessIncarnation'
    | 'getTerminalLivenessVerdict'
    | 'checkTerminalAgentPresence'
    | 'getOrchestrationDispatchAuthority'
    | 'ensureStructuredAgentSessionHost'
    | 'inspectTerminalProcessIncarnationLiveness'
    | 'closeTerminal'
    | 'isSetupTerminalRunning'
    | 'getExactWorkerProviderSession'
    | 'readTerminal'
    | 'notifyMessageArrived'
    | 'isWorkerAgentInTurn'
  > &
  // Lower runtime layers declare neither; without them a release closes its chat.
  Partial<
    Pick<
      VshuRuntimeService,
      'sleepWorkspaces' | 'bots' | 'listMobileSessionTabs' | 'savedTabsForWorktree'
    >
  >
