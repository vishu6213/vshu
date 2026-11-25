import { describe, expect, it, vi } from 'vitest'
import { ambientFrameAt, startAmbientMotion } from './ambient-motion'

type Listener = () => void

function fakeEnvironment(options: { visible: boolean; focused: boolean; reduced?: boolean }) {
  const docListeners = new Map<string, Listener>()
  const winListeners = new Map<string, Listener>()
  const state = { ...options }
  let nextHandle = 1
  const pendingFrames = new Map<number, (timestamp: number) => void>()
  const win = {
    innerWidth: 1200,
    innerHeight: 800,
    matchMedia: () => ({
      matches: Boolean(state.reduced),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }),
    requestAnimationFrame: (callback: (timestamp: number) => void) => {
      const handle = nextHandle++
      pendingFrames.set(handle, callback)
      return handle
    },
    cancelAnimationFrame: (handle: number) => {
      pendingFrames.delete(handle)
    },
    addEventListener: (name: string, listener: Listener) => winListeners.set(name, listener),
    removeEventListener: (name: string) => winListeners.delete(name)
  }
  const doc = {
    get visibilityState() {
      return state.visible ? 'visible' : 'hidden'
    },
    hasFocus: () => state.focused,
    documentElement: { hasAttribute: () => false },
    addEventListener: (name: string, listener: Listener) => docListeners.set(name, listener),
    removeEventListener: (name: string) => docListeners.delete(name)
  }
  const root = {
    querySelectorAll: () => [],
    style: { setProperty: vi.fn() }
  }
  return { state, win, doc, root, pendingFrames, docListeners }
}

function start(env: ReturnType<typeof fakeEnvironment>): () => void {
  return startAmbientMotion(env.root as unknown as HTMLElement, {
    win: env.win as unknown as Window,
    doc: env.doc as unknown as Document,
    now: () => 0
  })
}

describe('ambientFrameAt', () => {
  it('keeps every orb within its drift radius', () => {
    for (const seconds of [0, 13, 40, 97, 500]) {
      const frame = ambientFrameAt(seconds, 1200, 800)
      for (const { x, y } of Object.values(frame.orbs)) {
        expect(Math.abs(x)).toBeLessThanOrEqual(1200 * 0.09 + 0.001)
        expect(Math.abs(y)).toBeLessThanOrEqual(1200 * 0.09 + 0.001)
      }
      expect(Math.abs(frame.sheenX)).toBeLessThanOrEqual(1200 * 0.22 + 0.001)
    }
  })
})

describe('startAmbientMotion', () => {
  it('paints once and animates while the window is visible and focused', () => {
    const env = fakeEnvironment({ visible: true, focused: true })
    const stop = start(env)
    expect(env.root.style.setProperty).toHaveBeenCalled()
    expect(env.pendingFrames.size).toBe(1)
    stop()
    expect(env.pendingFrames.size).toBe(0)
  })

  it('stays paused while hidden and resumes when shown', () => {
    const env = fakeEnvironment({ visible: false, focused: true })
    const stop = start(env)
    expect(env.pendingFrames.size).toBe(0)
    env.state.visible = true
    env.docListeners.get('visibilitychange')?.()
    expect(env.pendingFrames.size).toBe(1)
    stop()
  })

  it('never animates under prefers-reduced-motion', () => {
    const env = fakeEnvironment({ visible: true, focused: true, reduced: true })
    const stop = start(env)
    expect(env.pendingFrames.size).toBe(0)
    stop()
  })
})
