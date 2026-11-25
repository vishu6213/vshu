import { getAppEnvironment, hasAppEnvironment } from '../app-lifecycle/app-environment'

export function getVshuCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'vshu-ide'
  }
  if (platform === 'win32') {
    return 'vshu.cmd'
  }
  return 'vshu'
}

/** The GNOME-conflict `vshu-ide` rename is desktop-only: SSH relays and headless Vshu servers put plain `vshu` on PATH. */
export function skipsLinuxVshuCliRename(isRemote: boolean | undefined): boolean {
  if (isRemote) {
    return true
  }
  // Only a headless server publishes its own launcher; Windows ones (WSL launches) keep the rename.
  const launcher = hasAppEnvironment() ? getAppEnvironment().getCliLauncherPath?.() : null
  return launcher?.endsWith('/vshu') ?? false
}
