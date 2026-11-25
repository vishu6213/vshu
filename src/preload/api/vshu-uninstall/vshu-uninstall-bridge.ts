import { ipcRenderer } from 'electron'
import type {
  VshuUninstallFinishAction,
  VshuUninstallPlan,
  VshuUninstallRunStepArgs
} from '../../../shared/uninstall/vshu-uninstall-types'
import type { PreloadApi } from '../../api-types'

export const vshuUninstallApi = {
  getPlan: (): Promise<VshuUninstallPlan> => ipcRenderer.invoke('vshuUninstall:getPlan'),
  runStep: (args: VshuUninstallRunStepArgs): Promise<VshuUninstallPlan> =>
    ipcRenderer.invoke('vshuUninstall:runStep', args),
  finish: (action: VshuUninstallFinishAction): Promise<void> =>
    ipcRenderer.invoke('vshuUninstall:finish', action)
} satisfies PreloadApi['vshuUninstall']
