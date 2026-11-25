import { VshudBindAddressError } from '../../../shared/remote-runtime/vshud-lifecycle/vshud-bind-address'
import { VshudBundledRuntimeError } from '../runtime-launch/vshud-bundled-runtime'
import { VshudInstanceLockError } from '../instance-lock/vshud-data-root-privacy'
import { ProfileStateAccessError } from '../../persistence/profile-state/access/profile-state-access-error'
import { VSHUD_EXIT_CONFIGURATION } from './vshud-configuration-exit'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from '../../../shared/app-lifecycle/launch/single-instance-exit-code'
import { VSHUD_EXIT_TERMINALS_NOT_DURABLE } from '../../../shared/remote-runtime/serve-supervisor/serve-supervised-terminal-durability'
import { VshudTerminalsNotDurableError } from './vshud-serve-supervision'

export const VSHUD_EXIT_FAILED = 1

export function resolveVshudExitCode(error: unknown): number {
  // Supervisors wait for an existing holder instead of abandoning the host.
  if (
    error instanceof VshudInstanceLockError &&
    error.code === 'vshud_instance_lock_holder_unverifiable'
  ) {
    return SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE
  }
  if (error instanceof VshudTerminalsNotDurableError) {
    return VSHUD_EXIT_TERMINALS_NOT_DURABLE
  }
  return error instanceof VshudInstanceLockError ||
    error instanceof VshudBindAddressError ||
    error instanceof VshudBundledRuntimeError ||
    error instanceof ProfileStateAccessError
    ? VSHUD_EXIT_CONFIGURATION
    : VSHUD_EXIT_FAILED
}
