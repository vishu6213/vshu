import { z } from 'zod'

export const VSHUD_PROFILE_PREFLIGHT_FLAG = '--vshud-profile-state-preflight'
export const VSHUD_STARTUP_PREFLIGHT_FLAG = '--vshud-startup-preflight'
export const VSHUD_PROFILE_PREFLIGHT_TIMEOUT_MS = 90_000
// Server startup follows the disposable native/SQLite probe on every bundled launch.
export const VSHUD_STARTUP_READINESS_TIMEOUT_MS = VSHUD_PROFILE_PREFLIGHT_TIMEOUT_MS + 90_000

export const VSHUD_PREFLIGHT_RUNTIMES = ['node', 'bun'] as const

/** The runtime the caller launched; the candidate must prove it ran under exactly this one. */
export type VshudPreflightRuntimeIdentity = {
  runtime: (typeof VSHUD_PREFLIGHT_RUNTIMES)[number]
  runtimeVersion: string
}

export const vshudProfilePreflightResponseSchema = z.object({
  type: z.literal('vshu_profile_state_ready'),
  nonce: z.string().uuid(),
  runtime: z.enum(VSHUD_PREFLIGHT_RUNTIMES),
  runtimeVersion: z.string().min(1),
  artifactVersion: z.string().regex(/^\d+\.\d+\.\d+\+[a-f0-9]{12}$/),
  sqliteVersion: z.string().min(1),
  revision: z.number().int().positive(),
  /** Daemon generations alive under the served data root, when asked; null when unverifiable. */
  liveDaemonProtocols: z.array(z.number().int().positive()).nullable().optional()
})

export type VshudProfilePreflightResponse = z.infer<typeof vshudProfilePreflightResponseSchema>

/** A fresh challenge prevents stale or unrelated output from admitting a candidate. */
export function parseVshudProfilePreflight(
  output: string,
  nonce: string,
  expected: VshudPreflightRuntimeIdentity,
  artifactVersion?: string
): VshudProfilePreflightResponse {
  const response = vshudProfilePreflightResponseSchema.parse(JSON.parse(output.trim()))
  if (
    response.nonce !== nonce ||
    response.runtime !== expected.runtime ||
    response.runtimeVersion !== expected.runtimeVersion ||
    (artifactVersion !== undefined && response.artifactVersion !== artifactVersion)
  ) {
    throw new Error('Profile preflight did not run under the expected candidate runtime')
  }
  return response
}
