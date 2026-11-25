import { BrowserWindow } from 'electron'
import {
  VSHU_PROFILE_AUTH_STATUS_CHANGED_CHANNEL,
  VSHU_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL,
  type VshuCloudSignInProgress
} from '../../../shared/vshu-profiles/vshu-profiles'

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

export function broadcastVshuProfileSignInProgressChanged(
  progress: VshuCloudSignInProgress | null
): void {
  broadcast(VSHU_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, progress)
}
