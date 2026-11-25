import { isAbsolute } from 'node:path'
import { accessSync, constants } from 'node:fs'
import { RuntimeClientError } from '../connection/types'

const electron = process.env.VSHU_CLI_ELECTRON_EXECUTABLE
delete process.env.VSHU_CLI_ELECTRON_EXECUTABLE
const packagedElectron =
  process.platform === 'darwin' && electron && isAbsolute(electron) ? electron : null

export function getPackagedElectronExecutable(): string | null {
  return packagedElectron
}

/** App-owned operations retain the root app's update and process identity. */
export function reenterPackagedElectron(): void {
  if (!packagedElectron) {
    return
  }
  const execve = process.execve
  if (!execve) {
    throw new RuntimeClientError(
      'unsupported_runtime',
      'The installed Vshu runtime is unavailable. Reinstall Vshu and try again.'
    )
  }
  try {
    accessSync(packagedElectron, constants.X_OK)
    accessSync(process.argv[1], constants.R_OK)
  } catch {
    throw new RuntimeClientError(
      'app_not_found',
      'The installed Vshu app is unavailable. Reinstall Vshu and try again.'
    )
  }
  execve.call(process, packagedElectron, [packagedElectron, ...process.argv.slice(1)], {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1'
  })
}
