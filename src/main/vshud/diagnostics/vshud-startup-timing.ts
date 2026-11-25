/** Startup phase timing for the real-distro lane; inert unless its launch env sets the variable. */
export const VSHUD_STARTUP_TIMING_ENV = 'VSHU_E2E_VSHUD_STARTUP_TIMING'

export const VSHUD_STARTUP_TIMING_PREFIX = '[vshud] startup timing '

/** Each phase's start and end, in ms since this process started. */
type VshudStartupPhase = [name: string, startMs: number, endMs: number]

export function createVshudStartupTiming(
  env: NodeJS.ProcessEnv = process.env,
  now: () => number = () => performance.now(),
  write: (line: string) => void = (line) => console.error(line)
) {
  const enabled = env[VSHUD_STARTUP_TIMING_ENV] === '1'
  const phases: VshudStartupPhase[] = []
  return {
    async time<T>(name: string, run: () => Promise<T>): Promise<T> {
      if (!enabled) {
        return run()
      }
      const startMs = now()
      try {
        return await run()
      } finally {
        phases.push([name, Math.round(startMs), Math.round(now())])
      }
    },
    /** One stderr line, so it lands in the slot log and never in the readiness stdout. */
    report(): void {
      if (enabled) {
        write(
          `${VSHUD_STARTUP_TIMING_PREFIX}${JSON.stringify({ readyMs: Math.round(now()), phases })}`
        )
      }
    }
  }
}
