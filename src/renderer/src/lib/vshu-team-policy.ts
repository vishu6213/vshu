import { useAppStore } from '@/store'
import {
  isVshuCloudTeamFeatureBlocked,
  type VshuCloudTeamFeatureFlag
} from '../../../shared/vshu-profiles/vshu-cloud-team-policy'

export function useVshuTeamFeatureBlocked(flag: VshuCloudTeamFeatureFlag): boolean {
  return useAppStore((state) => isVshuCloudTeamFeatureBlocked(state.vshuProfileAuthStatus, flag))
}
