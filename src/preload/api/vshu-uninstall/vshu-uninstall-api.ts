import type {
  VshuUninstallFinishAction,
  VshuUninstallPlan,
  VshuUninstallRunStepArgs
} from '../../../shared/uninstall/vshu-uninstall-types'

export type VshuUninstallApi = {
  /** Read-only: what the cleanup would change on this machine. */
  getPlan: () => Promise<VshuUninstallPlan>
  /** Runs one step and returns the whole plan with that step's entries updated. */
  runStep: (args: VshuUninstallRunStepArgs) => Promise<VshuUninstallPlan>
  finish: (action: VshuUninstallFinishAction) => Promise<void>
}
