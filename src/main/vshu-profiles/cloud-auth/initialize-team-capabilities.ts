import type { VshuProfileSummary } from '../../../shared/vshu-profiles/vshu-profiles'
import { readStoredTeamPolicySession } from '../cloud-session/profile-cloud-session-store'
import { initializeActiveTeamProfile } from './active-team-capabilities'

export async function initializeTeamCapabilities(
  userDataPath: string,
  profile: VshuProfileSummary
): Promise<void> {
  const finish = initializeActiveTeamProfile(userDataPath, profile)
  if (profile.cloud) {
    finish(await readStoredTeamPolicySession(profile.id, userDataPath))
  }
}
