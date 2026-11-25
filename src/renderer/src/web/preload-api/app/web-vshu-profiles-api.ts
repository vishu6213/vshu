import type { PreloadApi } from '../../../../../preload/api-types'
import {
  DEFAULT_LOCAL_VSHU_PROFILE_ID,
  createDefaultLocalVshuProfile
} from '../../../../../shared/vshu-profiles/vshu-profiles'
import { noopUnsubscribe } from '../web-storage'

export function createWebVshuProfilesApi(): Partial<PreloadApi> {
  const webVshuProfileAuthStatus = () =>
    Promise.resolve({
      activeProfileId: DEFAULT_LOCAL_VSHU_PROFILE_ID,
      configured: false,
      state: 'unconfigured' as const,
      persistence: 'none' as const,
      setupMessage: 'Vshu Cloud sign-in is not available in the browser fallback.'
    })
  return {
    vshuProfiles: {
      list: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_VSHU_PROFILE_ID,
          profiles: [createDefaultLocalVshuProfile(0)],
          multiProfileUi: false
        }),
      authStatus: webVshuProfileAuthStatus,
      onAuthStatusChanged: () => noopUnsubscribe,
      onSignInProgressChanged: () => noopUnsubscribe,
      createLocal: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_VSHU_PROFILE_ID,
          profiles: [createDefaultLocalVshuProfile(0)],
          profile: createDefaultLocalVshuProfile(0)
        }),
      createCloudLinked: async () => ({
        status: 'unconfigured',
        auth: await webVshuProfileAuthStatus()
      }),
      switchProfile: () => Promise.resolve({ status: 'already-active' }),
      transferProject: (args) =>
        Promise.resolve({
          status: 'duplicate-target',
          sourceProfileId: args.sourceProfileId,
          targetProfileId: args.targetProfileId,
          sourceRepoId: args.repoId,
          duplicateRepoId: args.repoId
        }),
      findProjectProfiles: async () => ({ projects: [] }),
      connectCurrent: async () => ({
        status: 'unconfigured',
        auth: await webVshuProfileAuthStatus()
      }),
      signInProgress: async () => null,
      cancelSignIn: async () => {},
      refreshAuth: async () => ({
        status: 'unconfigured',
        auth: await webVshuProfileAuthStatus()
      }),
      signOutCurrent: async () => ({
        status: 'signed-out',
        auth: await webVshuProfileAuthStatus(),
        activeProfileId: DEFAULT_LOCAL_VSHU_PROFILE_ID,
        profiles: [createDefaultLocalVshuProfile(0)]
      }),
      selectOrg: async () => ({
        status: 'unconfigured',
        auth: await webVshuProfileAuthStatus()
      }),
      orgMembersList: async () => ({ status: 'unconfigured' }),
      orgMemberInvite: async () => ({ status: 'unconfigured' }),
      orgInviteRevoke: async () => ({ status: 'unconfigured' }),
      orgMemberChangeRole: async () => ({ status: 'unconfigured' }),
      orgMemberRemove: async () => ({ status: 'unconfigured' }),
      openCloudConsole: async () => ({ status: 'unconfigured' })
    }
  }
}
