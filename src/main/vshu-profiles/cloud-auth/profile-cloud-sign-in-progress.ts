import type { VshuCloudSignInProgress } from '../../../shared/vshu-profiles/vshu-profiles'

type ProgressListener = (progress: VshuCloudSignInProgress | null) => void

// Only the newest attempt owns progress; late updates from older attempts are ignored.
let current: { attempt: number; link: string | null; cancel: () => void } | null = null
const listeners = new Set<ProgressListener>()

function snapshot(): VshuCloudSignInProgress | null {
  return current ? { link: current.link } : null
}

function update(next: typeof current): void {
  current = next
  const progress = snapshot()
  for (const listener of listeners) {
    try {
      listener(progress)
    } catch (error) {
      console.warn('[vshu-profiles] Sign-in progress listener failed:', error)
    }
  }
}

export function getVshuCloudSignInProgress(): VshuCloudSignInProgress | null {
  return snapshot()
}

export function onVshuCloudSignInProgressChanged(listener: ProgressListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function startVshuCloudSignInProgress(attempt: number, cancel: () => void): void {
  update({ attempt, link: null, cancel })
}

export function setVshuCloudSignInLink(attempt: number, link: string | null): void {
  if (current?.attempt === attempt && current.link !== link) {
    update({ ...current, link })
  }
}

export function endVshuCloudSignInProgress(attempt?: number): void {
  if (current && (attempt === undefined || current.attempt === attempt)) {
    update(null)
  }
}

export function cancelVshuCloudSignIn(): void {
  current?.cancel()
}
