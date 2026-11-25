import { once } from 'node:events'
import { homedir } from 'node:os'
import { app, ipcMain, shell } from 'electron'
import { spawnDetachedWithoutInheritance } from '@vshu/process-host/isolated-detached-spawn'
import {
  VSHU_UNINSTALL_STEPS,
  type VshuUninstallFinishAction,
  type VshuUninstallPlan,
  type VshuUninstallRunStepArgs
} from '../../shared/uninstall/vshu-uninstall-types'
import { getClaudeAgentViewService } from '../claude/agent-view/agent-view-service'
import type { Store } from '../persistence/loading-store/store'
import { getLinuxRootPackageType } from '../updater/linux-package/linux-update-package-type'
import {
  findWindowsUninstaller,
  resolveVshuInstallIdentity
} from '../uninstall/vshu-install-identity'
import {
  buildVshuUninstallPlan,
  runVshuUninstallStep,
  type VshuUninstallHost
} from '../uninstall/vshu-uninstall-cleanup'
import {
  listVshuUninstallSshHosts,
  removeVshuUninstallSshHostHooks
} from '../uninstall/vshu-uninstall-ssh-hosts'
import { stopTerminalDaemonsForUninstall } from '../daemon/providers/lifecycle/daemon-uninstall-shutdown'
import { isLocalTerminalDaemonLive } from '../daemon/launch/local-terminal-daemon-stop'
import { readLocalCliInstallStatus, removeLocalCliRegistration } from './cli'

async function createHost(store: Store): Promise<VshuUninstallHost> {
  const userDataPath = app.getPath('userData')
  return {
    platform: process.platform,
    homeDir: homedir(),
    userDataPath,
    uid: process.getuid?.() ?? 0,
    identity: await resolveVshuInstallIdentity({
      platform: process.platform,
      isPackaged: app.isPackaged,
      exePath: app.getPath('exe'),
      homeDir: homedir(),
      env: process.env,
      linuxPackageType: process.platform === 'linux' ? getLinuxRootPackageType() : null
    }),
    disableAgentStatusHooks: async () => {
      await store.updateSettingsAndFlush(
        { agentStatusHooksEnabled: false },
        { notifyListeners: true }
      )
      // Settle the agent-view disable so it can't rewrite the marker after cleanup deletes it.
      await getClaudeAgentViewService().reconcile(store.getSettings())
    },
    getCliStatus: readLocalCliInstallStatus,
    removeCli: removeLocalCliRegistration,
    listHosts: () => listVshuUninstallSshHosts(userDataPath),
    removeHostHooks: (hostId) => removeVshuUninstallSshHostHooks(userDataPath, hostId),
    isTerminalDaemonLive: () => isLocalTerminalDaemonLive(userDataPath),
    stopTerminalDaemon: () => stopTerminalDaemonsForUninstall(userDataPath)
  }
}

async function openWindowsUninstaller(appPath: string | null): Promise<void> {
  const uninstaller =
    process.platform === 'win32' && appPath ? await findWindowsUninstaller(appPath) : null
  if (!appPath || !uninstaller) {
    throw new Error('The Vshu uninstaller was not found.')
  }
  const child = spawnDetachedWithoutInheritance({ program: uninstaller, args: [], cwd: appPath })
  child.unref()
  // Quit only once it starts; a refused launch rejects to Settings' error toast.
  await once(child, 'spawn')
}

export function registerVshuUninstallHandlers(store: Store): void {
  // Steps update the plan the renderer last read, so retries keep earlier results.
  let current: VshuUninstallPlan | null = null

  ipcMain.handle('vshuUninstall:getPlan', async (): Promise<VshuUninstallPlan> => {
    current = await buildVshuUninstallPlan(await createHost(store))
    return current
  })

  ipcMain.handle(
    'vshuUninstall:runStep',
    async (_event, args: VshuUninstallRunStepArgs): Promise<VshuUninstallPlan> => {
      if (!VSHU_UNINSTALL_STEPS.includes(args?.step)) {
        throw new Error(`Unknown uninstall step: ${String(args?.step)}`)
      }
      const only = Array.isArray(args.only)
        ? args.only.filter((id): id is string => typeof id === 'string')
        : undefined
      const host = await createHost(store)
      current = await runVshuUninstallStep(
        current ?? (await buildVshuUninstallPlan(host)),
        args.step,
        host,
        only
      )
      return current
    }
  )

  ipcMain.handle(
    'vshuUninstall:finish',
    async (_event, action: VshuUninstallFinishAction): Promise<void> => {
      const appPath = current?.appPath ?? (await createHost(store)).identity.appPath
      if (action === 'reveal-app') {
        if (appPath) {
          shell.showItemInFolder(appPath)
        }
        return
      }
      if (action === 'open-windows-uninstaller') {
        await openWindowsUninstaller(appPath)
        app.quit()
        return
      }
      if (action === 'quit') {
        app.quit()
      }
    }
  )
}
