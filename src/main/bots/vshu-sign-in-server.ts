import { hostname } from 'node:os'
import type { VshuSignInServer } from '../../shared/bots/host-vshu-sign-in'

/** This host's name for its signed-out copy when it is a headless Vshu server (`vshu serve`, vshud),
 *  as `vshu auth login` names it; null on a computer with Vshu's window. */
export function vshuSignInServer(runtime: { servesWithoutWindow(): boolean }): VshuSignInServer {
  return runtime.servesWithoutWindow() ? hostname().slice(0, 256) : null
}
