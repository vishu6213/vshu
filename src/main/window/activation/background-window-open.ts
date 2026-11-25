// Registered by the desktop main process; vshud has no window to open and leaves it unset.
let openWindowInBackground: (() => void) | null = null

export function setBackgroundWindowOpener(opener: () => void): void {
  openWindowInBackground = opener
}

/** Shows Vshu's window without taking the foreground; false when this host has no desktop. */
export function requestBackgroundWindowOpen(): boolean {
  if (!openWindowInBackground) {
    return false
  }
  openWindowInBackground()
  return true
}
