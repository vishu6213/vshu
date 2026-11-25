/** Managed vshud servers over SSH; desktop-only, so web clients leave it undefined. */
import { ipcRenderer } from 'electron'
import type {
  VshudDeltaMovePreview,
  VshudDeltaMoveResult,
  VshudManagedCancelStopResult,
  VshudManagedConversionResult,
  VshudManagedDeployResult,
  VshudManagedForgetResult,
  VshudManagedPastLiveTerminals,
  VshudManagedPendingMigrationRow,
  VshudManagedRecoveryResult,
  VshudManagedRestartResult,
  VshudManagedStaleLockReclaimRequest,
  VshudManagedStaleLockReclaimResult,
  VshudManagedRollbackResult,
  VshudManagedRuntimeStatus,
  VshudManagedStopResult
} from '../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import type { PublicKnownRuntimeEnvironment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import type {
  RuntimeSshAccessLinkRequest,
  RuntimeSshAccessUnlinkRequest
} from '../../../shared/remote-runtime/host-catalog/runtime-ssh-access'

export type ManagedVshudPreloadApi = {
  deploy: (args: {
    name: string
    sshTargetId: string
    force?: boolean
  }) => Promise<VshudManagedDeployResult>
  getStatus: (args: { selector: string }) => Promise<VshudManagedRuntimeStatus>
  update: (args: {
    selector: string
    force?: boolean
    pastLiveTerminals?: VshudManagedPastLiveTerminals
  }) => Promise<VshudManagedDeployResult>
  rollback: (args: { selector: string }) => Promise<VshudManagedRollbackResult>
  recover: (args: {
    selector: string
    /** Restore the snapshot over state a rejected build changed; see VSHUD_RECOVERY_CHANGED_STATE_CODE. */
    acceptChangedState?: boolean
  }) => Promise<VshudManagedRecoveryResult>
  /** Restarts from this client's SSH session; refused while terminals run. */
  restart: (args: { selector: string }) => Promise<VshudManagedRestartResult>
  /** Without `yes`, only reports whether the host's instance lock may be cleared. */
  reclaimStaleLock: (
    args: { selector: string } & VshudManagedStaleLockReclaimRequest
  ) => Promise<VshudManagedStaleLockReclaimResult>
  stop: (args: { selector: string }) => Promise<VshudManagedStopResult>
  cancelStop: (args: { selector: string }) => Promise<VshudManagedCancelStopResult>
  forget: (args: { selector: string }) => Promise<VshudManagedForgetResult>
  linkSshAccess: (args: RuntimeSshAccessLinkRequest) => Promise<PublicKnownRuntimeEnvironment>
  unlinkSshAccess: (args: RuntimeSshAccessUnlinkRequest) => Promise<PublicKnownRuntimeEnvironment>
  convertSshHost: (args: {
    sshTargetId: string
    name: string
  }) => Promise<VshudManagedConversionResult>
  listPendingMigrations: () => Promise<VshudManagedPendingMigrationRow[]>
  previewDeltaMove: (args: { sshTargetId: string }) => Promise<VshudDeltaMovePreview>
  moveDelta: (args: { sshTargetId: string }) => Promise<VshudDeltaMoveResult>
  keepServerVersion: (args: { sshTargetId: string }) => Promise<void>
  /** "Move anyway": the next connect leaves what can't move on this desktop. */
  allowMoveLeavingBehind: (args: { sshTargetId: string }) => Promise<void>
}

export const managedVshudApi: ManagedVshudPreloadApi = {
  deploy: (args) => ipcRenderer.invoke('runtimeEnvironments:deployVshud', args),
  getStatus: (args) => ipcRenderer.invoke('runtimeEnvironments:getVshudStatus', args),
  update: (args) => ipcRenderer.invoke('runtimeEnvironments:updateVshud', args),
  rollback: (args) => ipcRenderer.invoke('runtimeEnvironments:rollbackVshud', args),
  recover: (args) => ipcRenderer.invoke('runtimeEnvironments:recoverVshud', args),
  restart: (args) => ipcRenderer.invoke('runtimeEnvironments:restartVshud', args),
  reclaimStaleLock: (args) => ipcRenderer.invoke('runtimeEnvironments:reclaimVshudStaleLock', args),
  stop: (args) => ipcRenderer.invoke('runtimeEnvironments:stopVshud', args),
  cancelStop: (args) => ipcRenderer.invoke('runtimeEnvironments:cancelVshudStop', args),
  forget: (args) => ipcRenderer.invoke('runtimeEnvironments:forgetVshud', args),
  linkSshAccess: (args) => ipcRenderer.invoke('runtimeEnvironments:linkSshAccess', args),
  unlinkSshAccess: (args) => ipcRenderer.invoke('runtimeEnvironments:unlinkSshAccess', args),
  convertSshHost: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:convertSshHostToManagedVshud', args),
  listPendingMigrations: () => ipcRenderer.invoke('runtimeEnvironments:listPendingVshudMigrations'),
  previewDeltaMove: (args) => ipcRenderer.invoke('runtimeEnvironments:previewVshudDeltaMove', args),
  moveDelta: (args) => ipcRenderer.invoke('runtimeEnvironments:moveVshudDelta', args),
  keepServerVersion: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:keepVshudServerVersion', args),
  allowMoveLeavingBehind: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:allowVshudMoveLeavingBehind', args)
}
