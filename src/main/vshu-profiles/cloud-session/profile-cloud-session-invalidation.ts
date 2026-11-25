type VshuCloudSessionInvalidationListener = () => void

const listeners = new Set<VshuCloudSessionInvalidationListener>()

/** Auth-failure invalidation only; explicit sign-out returns fresh status directly. */
export function onVshuCloudSessionInvalidated(
  listener: VshuCloudSessionInvalidationListener
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitVshuCloudSessionInvalidated(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.warn(
        '[vshu-profiles] Cloud session invalidation listener failed:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}
