import { app } from 'electron'
import { join } from 'node:path'

let vshuProfileDirectory: string | null = null

/** Browser profile ids repeat across Vshu profiles ("default"), so their extension data lives per Vshu profile. */
export function configureBrowserExtensionProfileDataDirectory(profileDirectory: string): void {
  vshuProfileDirectory = profileDirectory
}

/** Root of the per-browser-profile extension stores (sync storage, grants and state, DNR). */
export function getBrowserExtensionProfileDataDirectory(): string {
  return join(vshuProfileDirectory ?? app.getPath('userData'), 'browser-extensions')
}
