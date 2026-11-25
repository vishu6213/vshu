// Remember failures only for this session so restarting retries once.
export type VshudUpdateFailureHost = { kind: 'ssh' | 'wsl'; id: string }

export type VshudUpdateFailure = { code: string; reason: string }

const failedThisLaunch = new Map<string, VshudUpdateFailure>()

function key(host: VshudUpdateFailureHost): string {
  return `${host.kind}:${host.id}`
}

export function recordVshudUpdateFailedThisLaunch(
  host: VshudUpdateFailureHost,
  failure: VshudUpdateFailure
): void {
  failedThisLaunch.set(key(host), failure)
}

export function vshudUpdateFailureThisLaunch(
  host: VshudUpdateFailureHost
): VshudUpdateFailure | null {
  return failedThisLaunch.get(key(host)) ?? null
}

export function vshudUpdateFailedThisLaunch(host: VshudUpdateFailureHost): boolean {
  return failedThisLaunch.has(key(host))
}

export function clearVshudUpdateFailedThisLaunch(host: VshudUpdateFailureHost): void {
  failedThisLaunch.delete(key(host))
}
