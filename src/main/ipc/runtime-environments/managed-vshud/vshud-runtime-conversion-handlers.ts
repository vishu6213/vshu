import { ipcMain } from 'electron'
import type {
  VshudManagedConversionResult,
  VshudManagedPendingMigrationRow
} from '../../../../shared/remote-runtime/vshud-lifecycle/vshud-managed-runtime'
import { listPendingManagedVshudMigrations } from '../../../managed-server/lifecycle/vshud-managed-migration-status'
import { convertSshTargetToManagedVshud } from '../../../managed-server/lifecycle/vshud-runtime-conversion'
import { conversionCollaborators } from '../../../managed-server/lifecycle/vshud-runtime-conversion-wiring'
import { requiredString } from './vshud-runtime-lifecycle-handlers'

export function registerVshudRuntimeConversionHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:convertSshHostToManagedVshud',
    (
      _event,
      args: { sshTargetId: string; name: string }
    ): Promise<VshudManagedConversionResult> => {
      return convertSshTargetToManagedVshud(getUserDataPath(), {
        sshTargetId: requiredString(args?.sshTargetId, 'SSH target'),
        name: requiredString(args?.name, 'Server name'),
        ...conversionCollaborators()
      })
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:listPendingVshudMigrations',
    (): VshudManagedPendingMigrationRow[] => listPendingManagedVshudMigrations(getUserDataPath())
  )
}
