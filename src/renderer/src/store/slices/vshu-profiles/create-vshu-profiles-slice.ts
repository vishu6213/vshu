import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  VshuCloudSignInProgress,
  VshuProfileAuthStatus,
  VshuProfileSummary,
  SwitchVshuProfileResult,
  TransferVshuProfileProjectArgs,
  TransferVshuProfileProjectResult
} from '../../../../../shared/vshu-profiles/vshu-profiles'
import type { AppState } from '../../types'
import {
  createVshuProfilesAuthActions,
  type VshuProfilesAuthActions
} from './vshu-profiles-auth-actions'

export type VshuProfilesSlice = VshuProfilesAuthActions & {
  vshuProfiles: VshuProfileSummary[]
  activeVshuProfileId: string | null
  vshuProfileAuthStatus: VshuProfileAuthStatus | null
  vshuProfileSignInProgress: VshuCloudSignInProgress | null
  vshuProfilesMultiProfileUi: boolean
  vshuProfilesLoading: boolean
  vshuProfileSwitching: boolean
  fetchVshuProfiles: () => Promise<void>
  fetchVshuProfileAuthStatus: () => Promise<VshuProfileAuthStatus | null>
  createLocalVshuProfile: (name?: string) => Promise<VshuProfileSummary | null>
  switchVshuProfile: (profileId: string) => Promise<SwitchVshuProfileResult | null>
  transferVshuProfileProject: (
    args: TransferVshuProfileProjectArgs
  ) => Promise<TransferVshuProfileProjectResult | null>
}

export const createVshuProfilesSlice: StateCreator<AppState, [], [], VshuProfilesSlice> = (
  set,
  get,
  api
) => ({
  vshuProfiles: [],
  activeVshuProfileId: null,
  vshuProfileAuthStatus: null,
  vshuProfileSignInProgress: null,
  vshuProfilesMultiProfileUi: false,
  vshuProfilesLoading: false,
  vshuProfileSwitching: false,

  fetchVshuProfiles: async () => {
    set({ vshuProfilesLoading: true })
    try {
      const [state, authStatus] = await Promise.all([
        window.api.vshuProfiles.list(),
        window.api.vshuProfiles.authStatus()
      ])
      set({
        activeVshuProfileId: state.activeProfileId,
        vshuProfiles: state.profiles,
        vshuProfilesMultiProfileUi: state.multiProfileUi,
        vshuProfileAuthStatus: authStatus,
        vshuProfilesLoading: false
      })
    } catch (err) {
      console.error('Failed to fetch Vshu profiles:', err)
      set({ vshuProfilesLoading: false })
    }
  },

  fetchVshuProfileAuthStatus: async () => {
    try {
      const authStatus = await window.api.vshuProfiles.authStatus()
      set({ vshuProfileAuthStatus: authStatus })
      return authStatus
    } catch (err) {
      console.error('Failed to fetch Vshu profile auth status:', err)
      return null
    }
  },

  createLocalVshuProfile: async (name) => {
    try {
      const state = await window.api.vshuProfiles.createLocal({ name })
      set({
        activeVshuProfileId: state.activeProfileId,
        vshuProfiles: state.profiles
      })
      void get().fetchVshuProfileAuthStatus()
      return state.profile
    } catch (err) {
      console.error('Failed to create Vshu profile:', err)
      toast.error(
        translate('auto.store.slices.vshu.profiles.612f7f6861', 'Failed to create profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  ...createVshuProfilesAuthActions(set, get, api),

  switchVshuProfile: async (profileId) => {
    if (!profileId || profileId === get().activeVshuProfileId) {
      return { status: 'already-active' }
    }
    set({ vshuProfileSwitching: true })
    try {
      const result = await window.api.vshuProfiles.switchProfile({ profileId })
      if (result?.status !== 'relaunching') {
        // Only actual relaunch locks switcher; stale already-active answers must unlock it.
        set({ vshuProfileSwitching: false })
      }
      return result
    } catch (err) {
      console.error('Failed to switch Vshu profile:', err)
      set({ vshuProfileSwitching: false })
      toast.error(
        translate('auto.store.slices.vshu.profiles.7d4bc516ee', 'Failed to switch profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  transferVshuProfileProject: async (args) => {
    try {
      const result = await window.api.vshuProfiles.transferProject(args)
      if (result.status === 'duplicate-target') {
        toast.error(
          translate(
            'auto.store.slices.vshu.profiles.f518e89aa5',
            'Project already exists in that profile'
          )
        )
      }
      if (result.status === 'transferred' && result.willRelaunch) {
        set({ vshuProfileSwitching: true })
      }
      return result
    } catch (err) {
      console.error('Failed to transfer Vshu profile project:', err)
      toast.error(
        translate('auto.store.slices.vshu.profiles.f03ae7f27b', 'Failed to transfer project'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  }
})
