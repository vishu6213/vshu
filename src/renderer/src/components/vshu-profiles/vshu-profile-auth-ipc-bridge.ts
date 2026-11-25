import { useAppStore } from '../../store'

export function registerVshuProfileAuthIpcBridge(unsubs: (() => void)[]): void {
  const api = window.api.vshuProfiles
  if (typeof api?.onAuthStatusChanged === 'function') {
    unsubs.push(
      api.onAuthStatusChanged(() => {
        void useAppStore.getState().fetchVshuProfileAuthStatus()
      })
    )
  }
  if (typeof api?.onSignInProgressChanged === 'function') {
    // Why: a sign-in can already be in flight when this window loads; a later event or teardown wins.
    let ignoreSnapshot = false
    const unsubscribe = api.onSignInProgressChanged((progress) => {
      ignoreSnapshot = true
      useAppStore.setState({ vshuProfileSignInProgress: progress })
    })
    unsubs.push(() => {
      ignoreSnapshot = true
      unsubscribe()
    })
    void Promise.resolve()
      .then(() => api.signInProgress())
      .then((progress) => {
        if (!ignoreSnapshot) {
          useAppStore.setState({ vshuProfileSignInProgress: progress ?? null })
        }
      })
      .catch(() => {})
  }
}
