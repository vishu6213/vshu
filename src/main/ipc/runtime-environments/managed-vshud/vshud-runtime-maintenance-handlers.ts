import { ipcMain } from 'electron'
import { registerManagedServerActions } from '../../../runtime/hosts/management/managed-server-actions-registry'
import {
  createManagedVshudActions,
  reclaimManagedVshudStaleLock,
  restartManagedVshud,
  type ManagedVshudActionOptions
} from './managed-vshud-actions'
import { requiredString } from './vshud-runtime-lifecycle-handlers'

export function registerVshudRuntimeMaintenanceHandlers(options: ManagedVshudActionOptions): void {
  const actions = createManagedVshudActions(options)
  // CLI runtime RPC uses these same managedServer actions.
  registerManagedServerActions(actions)
  ipcMain.handle(
    'runtimeEnvironments:updateVshud',
    async (
      _event,
      args: {
        selector: string
        force?: boolean
        pastLiveTerminals?: { incumbentVersion?: unknown; uncounted?: unknown }
      }
    ) => {
      const incumbentVersion = args?.pastLiveTerminals?.incumbentVersion
      const pastLiveTerminals =
        args?.pastLiveTerminals &&
        (typeof incumbentVersion === 'string' || incumbentVersion === null)
          ? {
              incumbentVersion,
              ...(args.pastLiveTerminals.uncounted === true ? { uncounted: true as const } : {})
            }
          : undefined
      return actions.update(
        requiredString(args?.selector, 'Server'),
        args?.force === true,
        pastLiveTerminals
      )
    }
  )
  ipcMain.handle('runtimeEnvironments:rollbackVshud', async (_event, args: { selector: string }) =>
    actions.rollback(requiredString(args?.selector, 'Server'))
  )
  ipcMain.handle(
    'runtimeEnvironments:recoverVshud',
    async (_event, args: { selector: string; acceptChangedState?: boolean }) =>
      actions.recover(requiredString(args?.selector, 'Server'), args?.acceptChangedState === true)
  )
  ipcMain.handle('runtimeEnvironments:restartVshud', async (_event, args: { selector: string }) =>
    restartManagedVshud(options, requiredString(args?.selector, 'Server'))
  )
  ipcMain.handle(
    'runtimeEnvironments:reclaimVshudStaleLock',
    async (_event, args: { selector: string; yes?: boolean; expectNonce?: string }) =>
      reclaimManagedVshudStaleLock(
        options,
        requiredString(args?.selector, 'Server'),
        // A confirmation without the checked record's nonce could clear a lock written since.
        args?.yes === true
          ? { yes: true, expectNonce: requiredString(args.expectNonce, 'The checked lock') }
          : { yes: false }
      )
  )
  ipcMain.handle('runtimeEnvironments:stopVshud', async (_event, args: { selector: string }) =>
    actions.stop(requiredString(args?.selector, 'Server'))
  )
  ipcMain.handle(
    'runtimeEnvironments:cancelVshudStop',
    async (_event, args: { selector: string }) =>
      actions.cancelStop(requiredString(args?.selector, 'Server'))
  )
  ipcMain.handle('runtimeEnvironments:forgetVshud', async (_event, args: { selector: string }) =>
    actions.forget(requiredString(args?.selector, 'Server'))
  )
}
