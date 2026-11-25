import type { VshudManagedStopRequest } from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-stop-request'
import { persistVshudDaemonRetirementRecord } from './vshud-completed-stop-receipt'
import type { VshudDaemonRetirement } from '../../daemon/vshud-daemon-retirement'
import { stopVshudAutomationScheduler } from '../../host-runtime/vshud-automations'
import { holdVshudTerminalAdmissionUntilExit } from './vshud-stop-terminal-admission'

// Keep daemon imports lazy so entry loading cannot initialize native code.
async function retireLazily(): Promise<VshudDaemonRetirement> {
  const { retireVshudDaemonIfIdle } = await import('../../daemon/vshud-daemon-retirement')
  return retireVshudDaemonIfIdle()
}

/** Record managed-stop outcomes without vetoing the stop. */
export async function prepareVshudManagedStop(
  request: VshudManagedStopRequest,
  retire: () => Promise<VshudDaemonRetirement> = retireLazily,
  stopAutomations: () => void = stopVshudAutomationScheduler,
  holdTerminalAdmission: () => void = holdVshudTerminalAdmissionUntilExit
): Promise<void> {
  // Fence spawns before potentially slow daemon retirement.
  holdTerminalAdmission()
  // Stop dispatch before census so new runs cannot race shutdown.
  stopAutomations()
  if (!request.retireIdleDaemon) {
    return
  }
  const outcome = await retire().catch((error: unknown): VshudDaemonRetirement => ({
    retirement: 'unverifiable',
    liveSessions: null,
    reason: `Retirement failed: ${error instanceof Error ? error.message : String(error)}`
  }))
  try {
    persistVshudDaemonRetirementRecord(request, outcome)
  } catch (error) {
    // Missing retirement records remain unverifiable to the completion reader.
    console.error('[vshud] could not record daemon retirement:', error)
  }
}
