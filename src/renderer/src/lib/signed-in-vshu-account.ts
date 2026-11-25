import { useAppStore } from '@/store'
import {
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../shared/execution-host/execution-host'

/** The Vshu account this window is signed in as; null signed out. */
export function signedInVshuAccount(): string | null {
  return useAppStore.getState().vshuProfileAuthStatus?.cloud?.userId ?? null
}

/**
 * Whose connector a host's reads are as, for keeping one account's answer from another's: this
 * window's own account for its own host; a paired server keeps its own account, so its id stands in.
 */
export function hostConnectorAccount(hostId: ExecutionHostId): string | null {
  return hostId === LOCAL_EXECUTION_HOST_ID ? signedInVshuAccount() : hostId
}
