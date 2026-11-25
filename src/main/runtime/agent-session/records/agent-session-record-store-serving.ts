import type { VshuRuntimeService } from '../../vshu-runtime'
import { isHostShuttingDown } from '../../../startup/quit/host-shutdown-state'
import { createStructuredAgentSessionLogger } from '../../../native-chat/agent-session-wire/host/structured-agent-session-logger'

type ServingRuntime = Pick<
  VshuRuntimeService,
  'openAgentSessionRecordStore' | 'startPullRequestWatches'
>

function startOldChatHistoryCleanup(runtime: ServingRuntime): void {
  void runtime.openAgentSessionRecordStore().catch((error: unknown) => {
    createStructuredAgentSessionLogger().error(
      'old chat journal: not checked (chat store failed to open)',
      {
        scope: 'old-chat-history-cleanup-open',
        error
      }
    )
  })
}

export function agentSessionRecordStoreHostServing(runtime: ServingRuntime): void {
  if (isHostShuttingDown()) {
    return
  }
  startOldChatHistoryCleanup(runtime)
  runtime.startPullRequestWatches({ admit: true })
}
