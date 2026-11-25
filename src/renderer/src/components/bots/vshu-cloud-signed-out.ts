// Whether a bot's Vshu Cloud features wait on this window's Vshu sign-in.
import { useAppStore } from '@/store'
import type { VshuProfileAuthStatus } from '../../../../shared/vshu-profiles/vshu-profiles'
import {
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../../shared/execution-host/execution-host'

function signedOut(status: VshuProfileAuthStatus | null): boolean {
  return status?.state === 'local' || status?.state === 'reconnect-required'
}

/** `useVshuCloudSignedOut` for code outside React. */
export function readVshuCloudSignedOut(hostId: ExecutionHostId = LOCAL_EXECUTION_HOST_ID): boolean {
  return (
    hostId === LOCAL_EXECUTION_HOST_ID && signedOut(useAppStore.getState().vshuProfileAuthStatus)
  )
}

/**
 * Whether Vshu Cloud features of `hostId`'s bots wait on this window's sign-in. Only this computer's:
 * Sign in here signs in this desktop, never a paired server.
 */
export function useVshuCloudSignedOut(hostId: ExecutionHostId = LOCAL_EXECUTION_HOST_ID): boolean {
  return useAppStore(
    (state) => hostId === LOCAL_EXECUTION_HOST_ID && signedOut(state.vshuProfileAuthStatus)
  )
}
