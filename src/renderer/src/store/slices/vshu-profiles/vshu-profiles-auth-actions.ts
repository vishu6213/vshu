import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  ConnectCurrentVshuProfileResult,
  CreateCloudLinkedVshuProfileResult,
  RefreshCurrentVshuProfileAuthResult,
  SelectVshuProfileOrgResult,
  SignOutCurrentVshuProfileResult
} from '../../../../../shared/vshu-profiles/vshu-profiles'
import type { AppState } from '../../types'

export type VshuProfilesAuthActions = {
  createCloudLinkedVshuProfile: (args: {
    orgId?: string
    name?: string
  }) => Promise<CreateCloudLinkedVshuProfileResult | null>
  connectCurrentVshuProfile: () => Promise<ConnectCurrentVshuProfileResult | null>
  refreshCurrentVshuProfileAuth: () => Promise<RefreshCurrentVshuProfileAuthResult | null>
  signOutCurrentVshuProfile: () => Promise<SignOutCurrentVshuProfileResult | null>
  selectVshuProfileOrg: (orgId: string) => Promise<SelectVshuProfileOrgResult | null>
}

export const createVshuProfilesAuthActions: StateCreator<
  AppState,
  [],
  [],
  VshuProfilesAuthActions
> = (set, get) => {
  let nextConnectAttempt = 0
  let appliedConnectAttempt = 0

  return {
    createCloudLinkedVshuProfile: async (args) => {
      try {
        const result = await window.api.vshuProfiles.createCloudLinked(args)
        set({
          vshuProfileAuthStatus: result.auth,
          ...(result.status === 'created'
            ? {
                activeVshuProfileId: result.activeProfileId,
                vshuProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'created') {
          toast.success(
            translate('auto.store.slices.vshu.profiles.319d7cf39b', 'Cloud profile created')
          )
        } else if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.vshu.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.vshu.profiles.f0c9e11a6d',
              'Failed to create cloud profile'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to create Vshu cloud profile:', err)
        toast.error(
          translate('auto.store.slices.vshu.profiles.f0c9e11a6d', 'Failed to create cloud profile'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    connectCurrentVshuProfile: async () => {
      const attempt = ++nextConnectAttempt
      try {
        // Pending PKCE must not block retry; newer linked waits supersede older callbacks.
        const result = await window.api.vshuProfiles.connectCurrent()
        if (attempt < appliedConnectAttempt) {
          return result
        }
        const alreadyConnected = get().vshuProfileAuthStatus?.state === 'connected'
        set({
          vshuProfileAuthStatus: result.auth,
          ...(result.status === 'connected'
            ? {
                activeVshuProfileId: result.activeProfileId,
                vshuProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'connected') {
          appliedConnectAttempt = attempt
          if (!alreadyConnected) {
            toast.success(
              translate('auto.store.slices.vshu.profiles.9fcb07a796', 'Profile connected')
            )
          }
        } else if (result.status === 'unconfigured') {
          toast.error(
            translate(
              'auto.store.slices.vshu.profiles.8b8fa73174',
              'Vshu Cloud sign-in is not configured'
            ),
            {
              description: result.auth.setupMessage
            }
          )
        } else if (result.status === 'timed-out' && !alreadyConnected) {
          toast.error(
            translate('auto.store.slices.vshu.profiles.signInTimedOut', 'Sign-in timed out')
          )
        } else if (
          result.status === 'failed' &&
          !alreadyConnected &&
          result.auth.state !== 'connected'
        ) {
          toast.error(
            translate('auto.store.slices.vshu.profiles.33290e88ed', 'Failed to connect profile'),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to connect Vshu profile:', err)
        if (
          attempt >= appliedConnectAttempt &&
          get().vshuProfileAuthStatus?.state !== 'connected'
        ) {
          toast.error(
            translate('auto.store.slices.vshu.profiles.33290e88ed', 'Failed to connect profile'),
            {
              description: err instanceof Error ? err.message : String(err)
            }
          )
        }
        return null
      }
    },

    refreshCurrentVshuProfileAuth: async () => {
      try {
        const result = await window.api.vshuProfiles.refreshAuth()
        set({
          vshuProfileAuthStatus: result.auth,
          ...(result.status === 'refreshed'
            ? {
                activeVshuProfileId: result.activeProfileId,
                vshuProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.vshu.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.vshu.profiles.2f6c78a039',
              'Failed to refresh profile auth'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to refresh Vshu profile auth:', err)
        toast.error(
          translate('auto.store.slices.vshu.profiles.2f6c78a039', 'Failed to refresh profile auth'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    },

    signOutCurrentVshuProfile: async () => {
      nextConnectAttempt += 1
      appliedConnectAttempt = nextConnectAttempt
      try {
        const result = await window.api.vshuProfiles.signOutCurrent()
        set({
          activeVshuProfileId: result.activeProfileId,
          vshuProfiles: result.profiles,
          vshuProfileAuthStatus: result.auth
        })
        if (result.auth.state !== 'connected') {
          toast.success(
            translate('auto.store.slices.vshu.profiles.a37b5e6d37', 'Signed out of Vshu')
          )
        }
        return result
      } catch (err) {
        console.error('Failed to sign out of Vshu profile:', err)
        toast.error(translate('auto.store.slices.vshu.profiles.83600521e7', 'Failed to sign out'), {
          description: err instanceof Error ? err.message : String(err)
        })
        return null
      }
    },

    selectVshuProfileOrg: async (orgId) => {
      try {
        const result = await window.api.vshuProfiles.selectOrg({ orgId })
        set({
          vshuProfileAuthStatus: result.auth,
          ...(result.status === 'selected'
            ? {
                activeVshuProfileId: result.activeProfileId,
                vshuProfiles: result.profiles
              }
            : {})
        })
        if (result.status === 'reconnect-required') {
          toast.error(
            translate('auto.store.slices.vshu.profiles.d6e764e7db', 'Reconnect this profile')
          )
        } else if (result.status === 'failed') {
          toast.error(
            translate(
              'auto.store.slices.vshu.profiles.76deec8f58',
              'Failed to switch organization'
            ),
            { description: result.error }
          )
        }
        return result
      } catch (err) {
        console.error('Failed to switch Vshu profile org:', err)
        toast.error(
          translate('auto.store.slices.vshu.profiles.76deec8f58', 'Failed to switch organization'),
          {
            description: err instanceof Error ? err.message : String(err)
          }
        )
        return null
      }
    }
  }
}
