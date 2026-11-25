import { CrewReadModel } from './crew-read-model'
import { fixture } from './crew-read-model.test-fixture'
import { subscribeCrew } from './crew-stream'
import { agentSessionRecordFixture } from '../../../native-chat/testing/agent-session-record-test-fixture'
import { agentSessionConversationView } from '../../../../shared/agent-session/lifecycle/leases/agent-session-conversation-view'
import { testVshuSessionId } from '../../../../shared/agent-session/identity/vshu-session-address-test-fixture'
import { formatVshuSessionAddress } from '../../../../shared/agent-session/identity/vshu-session-address'
import type { MountedCrewProducerModule } from '../../../../shared/orchestration/orchestration-crew-mounted.test-fixture'

export const createMountedCrewProducer: MountedCrewProducerModule['createMountedCrewProducer'] =
  () => {
    const f = fixture()
    const sessionId = testVshuSessionId('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')
    const address = formatVshuSessionAddress(sessionId)
    const record = agentSessionConversationView(agentSessionRecordFixture({ sessionId }))
    f.deps.records = {
      listRecords: () => [record],
      getRecord: (id) => (id === sessionId ? record : null),
      getVisibleSessionTabIndex: () => ({ present: true, sessionIds: [sessionId] })
    }
    f.db.insertMessage({ from: address, to: 'term_worker', subject: 'Peer', body: 'Retained L' })
    f.db.insertMessage({ from: 'term_peer', to: 'term_helper', subject: 'Other', body: 'Other L' })
    const model = new CrewReadModel(() => f.deps, f.db.crewChanges.subscribe)
    return {
      address,
      subscribe: (party, emit) => subscribeCrew(() => model.read(party), model.subscribe, emit),
      removeAddress: () => {
        for (let index = 0; index < 2; index++) {
          f.db.createRun({
            objective: 'Remembered owner',
            coordinatorHandle: null,
            coordinatorPaneKey: null,
            coordinatorVshuSessionId: sessionId
          })
        }
        f.db.unbindOtherRunsForCoordinator(
          {
            terminalHandle: null,
            paneKey: null,
            vshuSessionId: sessionId
          },
          f.run.id
        )
      }
    }
  }
