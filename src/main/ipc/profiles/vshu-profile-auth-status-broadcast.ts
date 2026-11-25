import { BrowserWindow } from 'electron'
import {
  VSHU_PROFILE_AUTH_STATUS_CHANGED_CHANNEL,
  VSHU_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL,
  type VshuCloudSignInProgress
} from '../../../shared/vshu-profiles/vshu-profiles'
import {
  getActiveTeamCapabilities,
  onTeamCapabilitiesInvalidated
} from '../../vshu-profiles/cloud-auth/active-team-capabilities'

function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    try {
      window.webContents.send(channel, ...args)
    } catch {
      // A renderer can disappear between isDestroyed() and send().
    }
  }
}

export function broadcastVshuProfileAuthStatusChanged(): void {
  broadcast(VSHU_PROFILE_AUTH_STATUS_CHANGED_CHANNEL)
}

export function broadcastTeamPolicyChanges(): void {
  const snapshot = (): string | undefined => {
    const team = getActiveTeamCapabilities()
    return team && JSON.stringify([team.teamPolicy, team.flags])
  }
  let previous = snapshot()
  onTeamCapabilitiesInvalidated(() => {
    const next = snapshot()
    if (next !== previous) {
      previous = next
      broadcastVshuProfileAuthStatusChanged()
    }
  })
}

export function broadcastVshuProfileSignInProgressChanged(
  progress: VshuCloudSignInProgress | null
): void {
  broadcast(VSHU_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, progress)
}
