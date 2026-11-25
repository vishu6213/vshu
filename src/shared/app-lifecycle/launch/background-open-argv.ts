/** `vshu open` launches carry this so Vshu shows its window without taking the foreground. */
export const BACKGROUND_OPEN_ARG = '--vshu-background-open'

export function argvRequestsBackgroundOpen(argv: readonly string[]): boolean {
  return argv.includes(BACKGROUND_OPEN_ARG)
}
