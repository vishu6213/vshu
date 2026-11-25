import { sshExecutionHostStorageIdentity } from '../identity/browser-execution-host-storage-identity'
import {
  deriveBrowserRoutePartition,
  deriveLocalSshBrowserRoutePartitionStorageScope
} from '../partitions/browser-route-identity'
import {
  activeBrowserRoutePartitionVshuProfileId,
  currentBrowserRoutePartitionBindingStore
} from '../partitions/browser-route-partition-binding-runtime'
import { isBrowserRoutePartitionRetainedByAnyOwner } from '../partitions/browser-route-partition-retention'
import { releaseEvictedBrowserRoutePartitionStorage } from '../partitions/browser-route-partition-storage-dependencies'
import { browserSessionRegistry } from '../../sessions/profiles/browser-session-registry'

const AUTHORITY_CONNECTION_IDENTITY_TAG = 'vshu-local-ssh-browser'
const AUTHORITY_CONNECTION_IDENTITY_VERSION = 1

// Keep the identity stable across restarts to preserve cookies.
export function localSshBrowserAuthorityConnectionIdentity(vshuProfileId: string): string {
  return JSON.stringify([
    AUTHORITY_CONNECTION_IDENTITY_TAG,
    AUTHORITY_CONNECTION_IDENTITY_VERSION,
    vshuProfileId
  ])
}

/** The jar a page or import already bound for this target and profile; null when none has. */
export function boundLocalSshBrowserPartition(
  targetId: string,
  browserProfileId: string
): string | null {
  const vshuProfileId = activeBrowserRoutePartitionVshuProfileId()
  if (!vshuProfileId) {
    return null
  }
  const derived = deriveLocalSshBrowserPartition(vshuProfileId, targetId, browserProfileId)
  const persisted = currentBrowserRoutePartitionBindingStore().get(derived.partition)
  if (persisted === null) {
    return null
  }
  if (persisted !== derived.bindingFingerprint) {
    throw new Error('browser_route_partition_binding_conflict')
  }
  return derived.partition
}

/** The jars these hosts' pages of one profile have bound; reads the binding file once for all hosts. */
export function boundLocalSshBrowserPartitionsForProfile(
  targetIds: readonly string[],
  browserProfileId: string
): string[] {
  const vshuProfileId = activeBrowserRoutePartitionVshuProfileId()
  if (!vshuProfileId || targetIds.length === 0) {
    return []
  }
  const bindings = currentBrowserRoutePartitionBindingStore().listBindings()
  return targetIds.flatMap((targetId) => {
    const derived = deriveLocalSshBrowserPartition(vshuProfileId, targetId, browserProfileId)
    // A different fingerprint is another identity's jar.
    return bindings.get(derived.partition)?.fingerprint === derived.bindingFingerprint
      ? [derived.partition]
      : []
  })
}

/** Binds the jar this target's pages of this profile will use, so Settings can fill it before any page opens. */
export function bindLocalSshBrowserPartition(targetId: string, browserProfileId: string): string {
  const vshuProfileId = activeBrowserRoutePartitionVshuProfileId()
  if (!vshuProfileId) {
    throw new Error('browser_local_route_profile_unavailable')
  }
  browserSessionRegistry.requireRouteBrowserProfile(browserProfileId)
  return bindLocalSshBrowserPartitionFor(vshuProfileId, targetId, browserProfileId).partition
}

export function bindLocalSshBrowserPartitionFor(
  vshuProfileId: string,
  targetId: string,
  browserProfileId: string
): ReturnType<typeof deriveBrowserRoutePartition> {
  const derived = deriveLocalSshBrowserPartition(vshuProfileId, targetId, browserProfileId)
  const bindings = currentBrowserRoutePartitionBindingStore({
    isPartitionRetained: isBrowserRoutePartitionRetainedByAnyOwner
  })
  const persistedFingerprint = bindings.get(derived.partition)
  if (persistedFingerprint === null) {
    const evicted = bindings.set(
      derived.partition,
      derived.bindingFingerprint,
      deriveLocalSshBrowserRoutePartitionStorageScope({ vshuProfileId, targetId })
    )
    if (evicted.length > 0) {
      void releaseEvictedBrowserRoutePartitionStorage(
        evicted,
        isBrowserRoutePartitionRetainedByAnyOwner
      )
    }
  } else if (persistedFingerprint !== derived.bindingFingerprint) {
    throw new Error('browser_route_partition_binding_conflict')
  } else {
    bindings.touch(derived.partition)
  }
  return derived
}

export function deriveLocalSshBrowserPartition(
  vshuProfileId: string,
  targetId: string,
  browserProfileId: string
): ReturnType<typeof deriveBrowserRoutePartition> {
  return deriveBrowserRoutePartition({
    vshuProfileId,
    browserProfileId,
    authorityConnectionIdentity: localSshBrowserAuthorityConnectionIdentity(vshuProfileId),
    executionHostIdentity: sshExecutionHostStorageIdentity(targetId)
  })
}
