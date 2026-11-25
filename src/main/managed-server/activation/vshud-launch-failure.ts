import { VshudWindowsLaunchFailedError } from '../install/vshud-remote-launch-windows'
import { VshudLaunchReadinessError } from './vshud-active-readiness'

/** A launch that ended a run: it never became ready, or the host reported it could not start. */
export function isVshudLaunchFailure(error: unknown): error is Error {
  return (
    error instanceof VshudLaunchReadinessError || error instanceof VshudWindowsLaunchFailedError
  )
}

/** Only a readiness failure had a running vshud, whose death the next vshud will report. */
export function vshudLaunchFailureRanProcess(error: Error): boolean {
  return error instanceof VshudLaunchReadinessError
}
