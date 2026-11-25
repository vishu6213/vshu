// Resumed stale holders must prove their generation on-host before every step, preventing writes or release under a successor's fence.
import { AsyncLocalStorage } from 'node:async_hooks'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { isSshCommandExitError } from '../../ssh/remote-exec/remote-exec-command'

export const VSHUD_FENCE_OWNER_FILENAME = '.vshu-fence-owner'
export const VSHUD_FENCE_LOST_MARKER = '__VSHUD_FENCE_LOST__'
/** EX_TEMPFAIL: this superseded generation cannot retry its step. */
export const VSHUD_FENCE_LOST_EXIT = 75

export type VshudFence = { lockDir: string; token: string }

const scope = new AsyncLocalStorage<VshudFence>()

export function runWithVshudFence<T>(fence: VshudFence, run: () => Promise<T>): Promise<T> {
  return scope.run(fence, run)
}

export function currentVshudFence(): VshudFence | null {
  return scope.getStore() ?? null
}

export class VshudFenceLostError extends Error {
  constructor() {
    super(
      "This run's activation fence was taken over by another run, so it stopped before changing the host."
    )
    this.name = 'VshudFenceLostError'
  }
}

export function posixVshudFenceOwnedTest(fence: VshudFence): string {
  const owner = quotePosixShell(
    `${fence.lockDir.replace(/\/+$/u, '')}/${VSHUD_FENCE_OWNER_FILENAME}`
  )
  return `[ "$(cat ${owner} 2>/dev/null)" = ${quotePosixShell(fence.token)} ]`
}

export function posixVshudFenceGuard(fence: VshudFence): string {
  return `${posixVshudFenceOwnedTest(fence)} || { echo ${VSHUD_FENCE_LOST_MARKER}; exit ${VSHUD_FENCE_LOST_EXIT}; };`
}

/** Use exit status and stdout; error messages quote commands containing the marker even when no guard failed. */
export function isVshudFenceLost(error: unknown): boolean {
  if (!isSshCommandExitError(error)) {
    return false
  }
  // `powershell -Command` reports any nonzero native exit as 1.
  const exited = error.exitCode === VSHUD_FENCE_LOST_EXIT || error.exitCode === 1
  return exited && error.stdout.trim().split(/\r?\n/u).at(-1) === VSHUD_FENCE_LOST_MARKER
}
