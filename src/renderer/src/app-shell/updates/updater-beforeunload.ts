import {
  VSHU_APP_RESTART_ABORTED_EVENT,
  VSHU_APP_RESTART_STARTED_EVENT,
  VSHU_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  VSHU_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT
} from '../../../../shared/updater/updater-renderer-events'
import { VSHU_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT } from '../../../../shared/app-lifecycle/shutdown/renderer-shutdown-events'

let intentionalAppRestartInProgress = false

export function isIntentionalAppRestartInProgress(): boolean {
  return intentionalAppRestartInProgress
}

export function registerUpdaterBeforeUnloadBypass(): () => void {
  const markInProgress = (): void => {
    intentionalAppRestartInProgress = true
  }
  const clearInProgress = (): void => {
    intentionalAppRestartInProgress = false
  }

  window.addEventListener(VSHU_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markInProgress)
  window.addEventListener(VSHU_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, clearInProgress)
  window.addEventListener(VSHU_APP_RESTART_STARTED_EVENT, markInProgress)
  window.addEventListener(VSHU_APP_RESTART_ABORTED_EVENT, clearInProgress)
  window.addEventListener(VSHU_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT, clearInProgress)

  return () => {
    window.removeEventListener(VSHU_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT, markInProgress)
    window.removeEventListener(VSHU_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, clearInProgress)
    window.removeEventListener(VSHU_APP_RESTART_STARTED_EVENT, markInProgress)
    window.removeEventListener(VSHU_APP_RESTART_ABORTED_EVENT, clearInProgress)
    window.removeEventListener(VSHU_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT, clearInProgress)
    // HMR can re-register listeners; cleanup must reset the flag so failed restarts cannot suppress later unsaved-change prompts.
    intentionalAppRestartInProgress = false
  }
}
