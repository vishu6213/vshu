import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../../api-types'
import {
  VSHU_PROFILE_AUTH_STATUS_CHANGED_CHANNEL,
  VSHU_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL,
  type VshuCloudSignInProgress,
  type VshuProfileListResult,
  type SwitchVshuProfileResult,
  type TransferVshuProfileProjectResult
} from '../../../shared/vshu-profiles/vshu-profiles'
import { prepareAndInvokeAppRestart } from '../../renderer/restart/renderer-restart-wiring'
import { awaitBeforeUnloadCheckpoint } from '../../renderer/renderer-runtime'

export const vshuProfilesApi = {
  list: () => ipcRenderer.invoke('vshuProfiles:list'),
  authStatus: () => ipcRenderer.invoke('vshuProfiles:authStatus'),
  onAuthStatusChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(VSHU_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(VSHU_PROFILE_AUTH_STATUS_CHANGED_CHANNEL, listener)
  },
  onSignInProgressChanged: (
    callback: (progress: VshuCloudSignInProgress | null) => void
  ): (() => void) => {
    const listener = (_event: unknown, progress: VshuCloudSignInProgress | null): void =>
      callback(progress)
    ipcRenderer.on(VSHU_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(VSHU_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, listener)
  },
  createLocal: (args) => ipcRenderer.invoke('vshuProfiles:createLocal', args),
  createCloudLinked: (args) => ipcRenderer.invoke('vshuProfiles:createCloudLinked', args),
  switchProfile: (args) =>
    prepareAndInvokeAppRestart(
      window,
      (): Promise<SwitchVshuProfileResult> => ipcRenderer.invoke('vshuProfiles:switch', args),
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'relaunching'
    ),
  transferProject: async (args) => {
    const invoke = (): Promise<TransferVshuProfileProjectResult> =>
      ipcRenderer.invoke('vshuProfiles:transferProject', args)
    if (args.mode !== 'move') {
      return invoke()
    }
    const current: VshuProfileListResult = await ipcRenderer.invoke('vshuProfiles:list')
    if (args.sourceProfileId !== current.activeProfileId) {
      return invoke()
    }
    return prepareAndInvokeAppRestart(
      window,
      invoke,
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'transferred' && result.willRelaunch === true
    )
  },
  findProjectProfiles: (args) => ipcRenderer.invoke('vshuProfiles:findProjectProfiles', args),
  connectCurrent: () => ipcRenderer.invoke('vshuProfiles:connectCurrent'),
  signInProgress: () => ipcRenderer.invoke('vshuProfiles:signInProgress'),
  cancelSignIn: () => ipcRenderer.invoke('vshuProfiles:cancelSignIn'),
  refreshAuth: () => ipcRenderer.invoke('vshuProfiles:refreshAuth'),
  signOutCurrent: () => ipcRenderer.invoke('vshuProfiles:signOutCurrent'),
  selectOrg: (args) => ipcRenderer.invoke('vshuProfiles:selectOrg', args),
  orgMembersList: (args) => ipcRenderer.invoke('vshuProfiles:orgMembersList', args),
  orgMemberInvite: (args) => ipcRenderer.invoke('vshuProfiles:orgMemberInvite', args),
  orgInviteRevoke: (args) => ipcRenderer.invoke('vshuProfiles:orgInviteRevoke', args),
  orgMemberChangeRole: (args) => ipcRenderer.invoke('vshuProfiles:orgMemberChangeRole', args),
  orgMemberRemove: (args) => ipcRenderer.invoke('vshuProfiles:orgMemberRemove', args),
  openCloudConsole: (args) => ipcRenderer.invoke('vshuProfiles:openCloudConsole', args)
} satisfies PreloadApi['vshuProfiles']
