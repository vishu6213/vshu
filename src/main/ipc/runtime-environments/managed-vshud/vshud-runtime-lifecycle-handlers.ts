import { ipcMain } from 'electron'
import type { VshudManagedRuntimeStatus } from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import { createManagedVshudEnvironment } from '../../../managed-server/lifecycle/vshud-runtime-deployment'
import { getManagedVshudRuntimeStatus } from '../../../managed-server/lifecycle/vshud-runtime-status'

export function registerVshudRuntimeLifecycleHandlers(options: {
  getUserDataPath: () => string
}): void {
  ipcMain.handle(
    'runtimeEnvironments:deployVshud',
    async (_event, args: { name: string; sshTargetId: string; force?: boolean }) =>
      createManagedVshudEnvironment(options.getUserDataPath(), {
        name: requiredString(args?.name, 'Server name'),
        sshTargetId: requiredString(args?.sshTargetId, 'SSH target'),
        force: args?.force === true
      })
  )
  ipcMain.handle(
    'runtimeEnvironments:getVshudStatus',
    (_event, args: { selector: string }): Promise<VshudManagedRuntimeStatus> =>
      getManagedVshudRuntimeStatus(
        options.getUserDataPath(),
        requiredString(args?.selector, 'Server')
      )
  )
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`)
  }
  return value.trim()
}
