/** Desktop main publishes managed-server actions for runtime RPC; headless hosts without a registry advertise none. */
import type {
  VshudManagedPastLiveTerminals,
  VshudManagedCancelStopResult,
  VshudManagedDeployResult,
  VshudManagedForgetResult,
  VshudManagedRecoveryResult,
  VshudManagedRollbackResult,
  VshudManagedRuntimeStatus,
  VshudManagedStopResult
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'

export type ManagedServerActions = {
  status: (selector: string) => Promise<VshudManagedRuntimeStatus>
  update: (
    selector: string,
    force: boolean,
    pastLiveTerminals?: VshudManagedPastLiveTerminals,
    /** With force, accepts that terminals vshud runs itself end when the census cannot count them. */
    endInProcessTerminals?: boolean
  ) => Promise<VshudManagedDeployResult>
  rollback: (selector: string) => Promise<VshudManagedRollbackResult>
  /** `acceptChangedState` restores the snapshot over state a rejected build changed. */
  recover: (selector: string, acceptChangedState?: boolean) => Promise<VshudManagedRecoveryResult>
  stop: (selector: string) => Promise<VshudManagedStopResult>
  cancelStop: (selector: string) => Promise<VshudManagedCancelStopResult>
  forget: (selector: string) => Promise<VshudManagedForgetResult>
  /** Forget only while another saved entry still manages the same server. */
  forgetRedundant: (selector: string) => Promise<VshudManagedForgetResult>
}

let registered: ManagedServerActions | null = null

export function registerManagedServerActions(actions: ManagedServerActions | null): void {
  registered = actions
}

export function getManagedServerActions(): ManagedServerActions | null {
  return registered
}
