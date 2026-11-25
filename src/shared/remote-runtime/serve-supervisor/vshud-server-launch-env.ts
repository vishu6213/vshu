import { VSHUD_IDLE_TIMEOUT_ENV } from '../vshud-lifecycle/vshud-idle-exit'
import { VSHUD_MANAGED_ACTIVATION_ROOT_ENV } from './vshud-managed-launch-env'

/** WSL-host launch marker; SSH guests and WSLg retain their original PATH. */
export const VSHUD_WSL_HOST_ENV = 'VSHU_WSL_VSHUD_HOST'

/** Desktop-provided registry ID; guests cannot read it themselves. */
export const VSHUD_WSL_DISTRO_GUID_ENV = 'VSHU_WSL_DISTRO_GUID'

/** The AppImage file `vshu serve` runs from: vshud's slot has no Electron, so its browser helper launches this. */
export const VSHU_SERVE_APPIMAGE_ENV = 'VSHU_SERVE_APPIMAGE'

/**
 * What a client puts in a server's launch env. A user's own `vshud` started from one of the
 * server's shells is not that server, so every pane scrubs these.
 */
export const VSHUD_SERVER_LAUNCH_ENV_KEYS = [
  // Not client-managed.
  VSHUD_MANAGED_ACTIVATION_ROOT_ENV,
  // Keeps the default idle window.
  VSHUD_IDLE_TIMEOUT_ENV,
  // Not a WSL host: no migration capabilities, no /mnt/c refusal, no account-push wait.
  VSHUD_WSL_HOST_ENV,
  VSHUD_WSL_DISTRO_GUID_ENV,
  // A user's own vshud must look up its own installed app.
  VSHU_SERVE_APPIMAGE_ENV
] as const
