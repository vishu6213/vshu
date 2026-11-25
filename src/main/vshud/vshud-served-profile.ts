// The Vshu profile this vshud opened at startup, which it serves for the process's life.

let served: string | null = null

export function recordVshudServedProfile(profileId: string): void {
  served = profileId
}

/** Null before a profile opens: nothing is served yet. */
export function vshudServedProfileId(): string | null {
  return served
}
