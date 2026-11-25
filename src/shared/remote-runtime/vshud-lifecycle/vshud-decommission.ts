import type { VshudManagedRefusal } from './vshud-managed-runtime'
import type { VshudDaemonRetirementVerdict } from './vshud-stop-request'

export type VshudDecommissionResult =
  | {
      outcome: 'decommissioned'
      version: string
      /** The daemon's fate: `retired`, or kept with its terminals (`live`/`unverifiable`). */
      retirement: VshudDaemonRetirementVerdict
    }
  | VshudManagedRefusal
