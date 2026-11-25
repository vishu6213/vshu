import type { VshuCloudAuthConfig } from './cloud-auth/profile-cloud-auth-config'

const PROBE_TIMEOUT_MS = 10_000

/** Whether Vshu Cloud accepts server sign-ins; checked before any browser opens because a
 * browser-side `unauthorized_client` never reaches the host. */
export type VshuServerSignInProbe = (
  config: Pick<VshuCloudAuthConfig, 'apiBaseUrl'>,
  clientId: string
) => Promise<boolean>

export async function probeVshuServerSignIn(
  config: Pick<VshuCloudAuthConfig, 'apiBaseUrl'>,
  clientId: string
): Promise<boolean> {
  const url = new URL(
    `/v1/desktop/auth/clients/${encodeURIComponent(clientId)}`,
    `${config.apiBaseUrl}/`
  )
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
  } catch {
    throw new Error("Couldn't reach Vshu Cloud. Check this server's network and try again.")
  }
  await response.body?.cancel().catch(() => {})
  if (response.status === 200) {
    return true
  }
  if (response.status === 404) {
    return false
  }
  throw new Error(`Vshu Cloud answered ${response.status}. Try again in a moment.`)
}
