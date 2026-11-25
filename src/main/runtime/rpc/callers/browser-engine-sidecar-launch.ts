// An vshud's browser engine is an Vshu app it starts without pairing; vshud is the caller on its socket.
let launchedAsBrowserEngineSidecar = false

export function markBrowserEngineSidecarLaunch(): void {
  launchedAsBrowserEngineSidecar = true
}

/** True in an vshud's browser engine, whose runtime calls come from that vshud, not from agents. */
export function isBrowserEngineSidecarLaunch(): boolean {
  return launchedAsBrowserEngineSidecar
}
