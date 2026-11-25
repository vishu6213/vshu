/** Frames per second for the ambient drift; slow motion reads smooth well below 60. */
export const AMBIENT_FPS = 12

type OrbPath = {
  /** Drift radius as a fraction of the viewport's larger side. */
  amplitude: number
  /** Seconds per loop on each axis; unequal periods give a Lissajous wander. */
  periodX: number
  periodY: number
  phase: number
}

const ORB_PATHS: Record<string, OrbPath> = {
  key: { amplitude: 0.07, periodX: 96, periodY: 71, phase: 0 },
  fill: { amplitude: 0.09, periodX: 83, periodY: 117, phase: 1.7 },
  rim: { amplitude: 0.06, periodX: 109, periodY: 89, phase: 3.1 }
}

const SHEEN_PERIOD_SECONDS = 96

export type AmbientFrame = {
  orbs: Record<string, { x: number; y: number }>
  sheenX: number
}

/** Pure position math, in px, for time `seconds` in a `width` x `height` viewport. */
export function ambientFrameAt(seconds: number, width: number, height: number): AmbientFrame {
  const span = Math.max(width, height)
  const orbs: AmbientFrame['orbs'] = {}
  for (const [name, path] of Object.entries(ORB_PATHS)) {
    const radius = path.amplitude * span
    orbs[name] = {
      x: Math.sin((seconds / path.periodX) * Math.PI * 2 + path.phase) * radius,
      y: Math.cos((seconds / path.periodY) * Math.PI * 2 + path.phase) * radius
    }
  }
  const sheenX = Math.sin((seconds / SHEEN_PERIOD_SECONDS) * Math.PI * 2) * width * 0.22
  return { orbs, sheenX }
}

export function paintAmbientFrame(root: HTMLElement, frame: AmbientFrame): void {
  for (const orb of root.querySelectorAll<HTMLElement>('[data-orb]')) {
    const position = frame.orbs[orb.dataset.orb ?? '']
    if (!position) {
      continue
    }
    orb.style.setProperty('--vshu-orb-x', `${position.x.toFixed(1)}px`)
    orb.style.setProperty('--vshu-orb-y', `${position.y.toFixed(1)}px`)
  }
  root.style.setProperty('--vshu-sheen-x', `${frame.sheenX.toFixed(1)}px`)
}

type AmbientEnvironment = {
  win: Window
  doc: Document
  now: () => number
}

function defaultEnvironment(): AmbientEnvironment {
  return { win: window, doc: document, now: () => performance.now() }
}

/**
 * Drives the ambient drift at AMBIENT_FPS. It runs only while the window is visible and focused,
 * motion is allowed (prefers-reduced-motion, Reduce visual effects) and stops on dispose.
 */
export function startAmbientMotion(
  root: HTMLElement,
  env: AmbientEnvironment = defaultEnvironment()
): () => void {
  const { win, doc, now } = env
  const reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)')
  const frameInterval = 1000 / AMBIENT_FPS
  // Start mid-loop so the first paint is already composed, not at every orb's origin.
  const epoch = now() - 37_000
  let frameHandle: number | null = null
  let lastPaint = -Infinity
  let disposed = false

  const paint = (): void => {
    paintAmbientFrame(root, ambientFrameAt((now() - epoch) / 1000, win.innerWidth, win.innerHeight))
  }

  const canAnimate = (): boolean =>
    !disposed &&
    doc.visibilityState === 'visible' &&
    doc.hasFocus() &&
    !reducedMotion?.matches &&
    !doc.documentElement.hasAttribute('data-reduce-effects')

  const tick = (timestamp: number): void => {
    frameHandle = null
    if (!canAnimate()) {
      return
    }
    if (timestamp - lastPaint >= frameInterval) {
      lastPaint = timestamp
      paint()
    }
    frameHandle = win.requestAnimationFrame(tick)
  }

  const sync = (): void => {
    if (canAnimate()) {
      if (frameHandle === null) {
        frameHandle = win.requestAnimationFrame(tick)
      }
      return
    }
    if (frameHandle !== null) {
      win.cancelAnimationFrame(frameHandle)
      frameHandle = null
    }
  }

  paint()
  sync()
  doc.addEventListener('visibilitychange', sync)
  win.addEventListener('focus', sync)
  win.addEventListener('blur', sync)
  reducedMotion?.addEventListener?.('change', sync)
  // Reduce visual effects flips an attribute on the root, with no event of its own.
  const effectsObserver = typeof MutationObserver === 'function' ? new MutationObserver(sync) : null
  effectsObserver?.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ['data-reduce-effects']
  })

  return () => {
    effectsObserver?.disconnect()
    disposed = true
    sync()
    doc.removeEventListener('visibilitychange', sync)
    win.removeEventListener('focus', sync)
    win.removeEventListener('blur', sync)
    reducedMotion?.removeEventListener?.('change', sync)
  }
}
