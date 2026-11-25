import { app } from 'electron'
import { resolveAppImageRuntimeIdentity } from '../../updater/linux-package/appimage-runtime-identity'
import { prepareAppImageCopyForServe } from '../../cli/appimage/appimage-serve-preparation'
import { CliInstaller } from '../../cli/cli-installer'
import { installLinuxBareVshuDispatcher } from '../../cli/launchers/linux-bare-vshu-dispatcher'

/** Headless serve has no renderer to run the normal cli:install flow, so it registers here. */
export async function registerCliForHeadlessServe(): Promise<void> {
  // Windows registry PATH installation cannot fix this server's existing child environments.
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return
  }
  const appImagePath =
    process.platform === 'linux' ? (resolveAppImageRuntimeIdentity()?.appImagePath ?? null) : null
  let appImageDeadlineAt: number | undefined
  if (appImagePath) {
    // Share one bounded AppImage extraction across CLI install/dispatcher and report progress.
    const preparation = await prepareAppImageCopyForServe({ appImagePath })
    if (preparation.status === 'unavailable') {
      console.warn(`[serve] vshu CLI install skipped: ${preparation.reason}`)
      return
    }
    appImageDeadlineAt = preparation.deadlineAt
  }
  try {
    // Headless serve cannot answer osascript elevation; user-local CLI installation needs none.
    const cliStatus = await new CliInstaller({
      privilegedRunner: async () => {
        throw new Error('serve CLI auto-install must not request administrator privileges')
      },
      ...(appImageDeadlineAt === undefined ? {} : { appImageDeadlineAt })
    }).install()
    console.log(
      `[serve] vshu CLI install: ${cliStatus.state}${cliStatus.commandPath ? ` (${cliStatus.commandPath})` : ''}`
    )
  } catch (error) {
    console.warn(
      '[serve] vshu CLI install skipped:',
      error instanceof Error ? error.message : String(error)
    )
  }
  // Linux installs vshu-ide; Claude Team invokes bare vshu, requiring a best-effort user-local dispatcher.
  if (process.platform === 'linux' && app.isPackaged && process.resourcesPath) {
    try {
      const dispatcher = await installLinuxBareVshuDispatcher({
        resourcesPath: process.resourcesPath,
        ...(appImageDeadlineAt === undefined ? {} : { appImageDeadlineAt })
      })
      console.log(
        `[serve] bare vshu dispatcher ${dispatcher.state}: ${dispatcher.dispatcherPath}` +
          `${dispatcher.target ? ` -> ${dispatcher.target}` : ''}`
      )
    } catch (error) {
      console.warn(
        '[serve] bare vshu dispatcher install skipped:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}
