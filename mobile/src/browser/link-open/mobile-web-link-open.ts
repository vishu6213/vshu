import { openExternalLink } from '../../platform/external-links/external-link'
import type { MobileLinkOpenMode } from '../../storage/preferences'
import { isLoopbackHttpUrl } from '../../../../src/shared/workspace/ports/localhost-worktree-labels'

/**
 * Where a web link tapped in terminal output or chat opens. The phone's browser stands in
 * wherever no Vshu browser tab can open (see useOpenUrlInVshu).
 */
export function openMobileWebLink(
  url: string,
  mode: MobileLinkOpenMode,
  openInVshu: ((url: string) => void) | undefined,
  ask: (url: string) => void
): void {
  // Why: a loopback URL names the host that printed it; the phone's own browser would load the phone.
  if (openInVshu && isLoopbackHttpUrl(url)) {
    openInVshu(url)
  } else if (mode === 'ask') {
    ask(url)
  } else if (mode === 'vshu-browser' && openInVshu) {
    openInVshu(url)
  } else {
    openExternalLink(url)
  }
}
