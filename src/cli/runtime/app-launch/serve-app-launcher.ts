import { accessSync, constants } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, relative } from 'node:path'
import { RuntimeClientError } from '../connection/types'
import { resolveLaunchUserDataPath } from '../profile/launch-user-data-path'
import { appImageEphemeralRootOf } from '../../../shared/desktop-distribution/appimage/appimage-ephemeral-root'

/** A remote server’s Node-based CLI cannot start a local app server. */
export function canStartVshuServer(env: NodeJS.ProcessEnv): boolean {
  const override = env.VSHU_APP_EXECUTABLE
  return (
    (typeof override === 'string' && override.trim().length > 0) || env.ELECTRON_RUN_AS_NODE === '1'
  )
}

/** Linux installs the app's CLI as `vshu-ide`: a bare `vshu` there is often the screen reader. */
export function appCliName(platform: NodeJS.Platform): string {
  return platform === 'linux' ? 'vshu-ide' : 'vshu'
}

const NOT_AN_APP_CLI =
  "This `vshu` command isn't running from an installed Vshu app. On a host Vshu reaches over SSH, it belongs to that connection's server and can't start one of its own."

export function serverOnlyServeMessage(platform: NodeJS.Platform): string {
  return `${NOT_AN_APP_CLI} Install the Vshu app on this machine and run \`${appCliName(platform)} serve\` from a plain login shell, or set VSHU_APP_EXECUTABLE to the Vshu app executable.`
}

function serverOnlyServiceInstallMessage(platform: NodeJS.Platform): string {
  const name = appCliName(platform)
  return `Could not find the installed Vshu app's \`${name}\` command on PATH. ${NOT_AN_APP_CLI} Install the Vshu app on this machine, then run \`${name} serve service install\` from a plain login shell so the service uses the app's own profile, or pass --command <absolute path to the app's ${name}>.`
}

function isVersionScopedDir(dir: string, userData: string): boolean {
  const inside = relative(userData, dir)
  return (
    inside === '' ||
    (!inside.startsWith('..') && !isAbsolute(inside)) ||
    dir.includes('vshud-artifacts') ||
    appImageEphemeralRootOf(dir) !== null
  )
}

/** PATH for a persisted service: entries tied to one Vshu version or AppImage launch are gone by its next start. */
export function resolveServicePath(env: NodeJS.ProcessEnv): string {
  const userData = resolveLaunchUserDataPath(env)
  const durable = (env.PATH ?? '')
    .split(delimiter)
    .filter((dir) => isAbsolute(dir) && !isVersionScopedDir(dir, userData))
  return durable.length > 0 ? durable.join(delimiter) : '/usr/bin:/bin'
}

/** The stable launcher on PATH: a version-specific executable would vanish with the next update. */
export function resolveServiceCommand(
  explicit: string | null,
  deps: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv }
): string {
  const isExecutable = (path: string): boolean => {
    try {
      accessSync(path, constants.X_OK)
      return true
    } catch {
      return false
    }
  }
  const userData = resolveLaunchUserDataPath(deps.env)
  if (explicit) {
    if (!isAbsolute(explicit) || !isExecutable(explicit)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--command must be an absolute path to an executable: ${explicit}`
      )
    }
    if (isVersionScopedDir(dirname(explicit), userData)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--command points at a launcher tied to one Vshu version, which the next update replaces: ${explicit}. Pass the installed Vshu app's \`${appCliName(deps.platform)}\` instead.`
      )
    }
    return explicit
  }
  const name = appCliName(deps.platform)
  for (const dir of (deps.env.PATH ?? '').split(delimiter).filter(isAbsolute)) {
    // Profile and AppImage launchers point at files that disappear with an update.
    if (!isVersionScopedDir(dir, userData) && isExecutable(join(dir, name))) {
      return join(dir, name)
    }
  }
  throw new RuntimeClientError(
    'cli_not_found',
    canStartVshuServer(deps.env)
      ? `Could not find the \`${name}\` command on PATH. Install it from Vshu Settings, or pass --command <absolute path>.`
      : serverOnlyServiceInstallMessage(deps.platform)
  )
}
