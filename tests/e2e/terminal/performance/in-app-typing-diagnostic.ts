import type { Page } from '@stablyai/playwright-test'

type TypingDiagnosticWindow = Window & {
  __vshuTypingDiagnostic?: {
    start: () => string
    stop: () => string
    report: () => unknown
  }
}

/** Runs the shipped renderer probe beside the bench: it splits the renderer-side phases the PTY sidecar cannot see. */
export async function withInAppTypingDiagnostic<T>(
  page: Page,
  enabled: boolean,
  run: () => Promise<T>
): Promise<{ result: T; report: unknown }> {
  if (!enabled) {
    return { result: await run(), report: null }
  }
  const started = await page.evaluate(() => {
    const target: TypingDiagnosticWindow = window
    return target.__vshuTypingDiagnostic?.start() ?? null
  })
  if (started === null) {
    return { result: await run(), report: { available: false } }
  }
  try {
    const result = await run()
    const report = await page.evaluate(() => {
      const target: TypingDiagnosticWindow = window
      target.__vshuTypingDiagnostic?.stop()
      return target.__vshuTypingDiagnostic?.report() ?? null
    })
    return { result, report }
  } finally {
    await page
      .evaluate(() => {
        const target: TypingDiagnosticWindow = window
        target.__vshuTypingDiagnostic?.stop()
      })
      .catch(() => undefined)
  }
}
