import { waitForStartupPhases } from './startup-phase-wait'

/**
 * Startup phases an vshud host finishes after its first RPC could arrive. A method that needs one
 * declares it (`requires`); the dispatcher waits a bounded time, then refuses retryably. Hosts that
 * never install a readiness (the desktop) have every feature open.
 */
export type VshudFeature = 'accounts' | 'sessionSearch' | 'orchestration' | 'unshownPlacement'

export const VSHUD_FEATURES: readonly VshudFeature[] = [
  'accounts',
  'sessionSearch',
  'orchestration',
  'unshownPlacement'
]

// Long enough to ride out a cold start; short enough that a caller's own retry takes over.
export const VSHUD_FEATURE_WAIT_MS = 10_000

export class VshudFeatureReadiness {
  private readonly pending = new Map<VshudFeature, { opened: Promise<void>; open: () => void }>()

  constructor(closed: readonly VshudFeature[] = []) {
    for (const feature of closed) {
      let open!: () => void
      const opened = new Promise<void>((resolve) => {
        open = resolve
      })
      this.pending.set(feature, { opened, open })
    }
  }

  isOpen(feature: VshudFeature): boolean {
    return !this.pending.has(feature)
  }

  open(feature: VshudFeature): void {
    this.pending.get(feature)?.open()
    this.pending.delete(feature)
  }

  /**
   * 'ready' once every feature is open; 'timeout' if any is still closed after `timeoutMs`;
   * 'aborted' as soon as any signal aborts (the client went away).
   */
  waitFor(
    features: readonly VshudFeature[],
    timeoutMs: number,
    signals: readonly (AbortSignal | undefined)[] = []
  ): Promise<'ready' | 'timeout' | 'aborted'> {
    const waits = features.flatMap((feature) => this.pending.get(feature)?.opened ?? [])
    return waitForStartupPhases(waits, timeoutMs, signals)
  }
}

// One runtime per vshud process; the desktop's never installs one, so all features read open.
let current = new VshudFeatureReadiness()

export function vshudFeatureReadiness(): VshudFeatureReadiness {
  return current
}

/** vshud startup: every feature starts closed and opens where its phase finishes. */
export function installVshudFeatureReadiness(): VshudFeatureReadiness {
  current = new VshudFeatureReadiness(VSHUD_FEATURES)
  return current
}

export function _resetVshudFeatureReadinessForTests(): void {
  current = new VshudFeatureReadiness()
}

/** A method's startup needs: fixed, or read from its parsed params (an agent launch, not a shell). */
export type VshudFeatureRequirement<P = never> =
  | readonly VshudFeature[]
  | ((params: P) => readonly VshudFeature[])

export function resolveVshudFeatureRequirement<P>(
  requires: VshudFeatureRequirement<P> | undefined,
  params: P
): readonly VshudFeature[] {
  return typeof requires === 'function' ? requires(params) : (requires ?? [])
}

/**
 * The wait for a method's required features, or null when nothing is closed, so ungated dispatch
 * keeps its synchronous start. Refuses with the existing retryable `runtime_unavailable`, also when
 * the request or its connection ends while waiting: the handler must never run for a caller that
 * left (a streaming handler's close cleanup would never fire; a retried mutation would run twice).
 */
export function rpcMethodFeatureWait(
  requires: readonly VshudFeature[],
  signals: readonly (AbortSignal | undefined)[] = [],
  timeoutMs = VSHUD_FEATURE_WAIT_MS
): Promise<void> | null {
  if (!requires.some((feature) => !current.isOpen(feature))) {
    return null
  }
  return current.waitFor(requires, timeoutMs, signals).then((outcome) => {
    if (outcome !== 'ready') {
      throw new Error('runtime_unavailable')
    }
  })
}

/** Adds `feature` to each method of a family, e.g. every `orchestration.*` method. */
export function requiringVshudFeature<
  M extends { readonly requires?: VshudFeatureRequirement<never> }
>(feature: VshudFeature, methods: readonly M[]): M[] {
  return methods.map((method) => {
    const own = method.requires
    return {
      ...method,
      requires:
        typeof own === 'function'
          ? (params: never) => [...own(params), feature]
          : [...(own ?? []), feature]
    }
  })
}
