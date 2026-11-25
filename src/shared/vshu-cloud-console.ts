// The Vshu web console, where team and admin settings are managed. The desktop only links to it;
// main opens the page in the system browser through a single-use ticket URL from auth.
import type { VshuProfileAuthStatus } from './vshu-profiles/vshu-profiles'

/** The capability auth sets for accounts that can use the web console. */
export const VSHU_CLOUD_CONSOLE_CAPABILITY = 'billing'

const VSHU_CLOUD_CONSOLE_SECTIONS = ['home'] as const
export type VshuCloudConsoleSection = (typeof VSHU_CLOUD_CONSOLE_SECTIONS)[number]

export type VshuCloudConsoleOpenArgs = { section: VshuCloudConsoleSection }

export type VshuCloudConsoleOpenResult =
  /** `ticketError`: a signed-in desktop's ticket failed or pointed off the allowed origins. */
  | { status: 'opened'; signedIn: boolean; ticketError?: 'failed' | 'rejected' }
  | { status: 'unconfigured' }
  | { status: 'failed'; error: string }

export function isVshuCloudConsoleSection(value: unknown): value is VshuCloudConsoleSection {
  return VSHU_CLOUD_CONSOLE_SECTIONS.some((section) => section === value)
}

/** UI only: the console re-checks access server side. */
export function isVshuCloudConsoleAvailable(auth: VshuProfileAuthStatus | null): boolean {
  return (
    auth?.state === 'connected' && auth.capabilities?.flags[VSHU_CLOUD_CONSOLE_CAPABILITY] === true
  )
}
