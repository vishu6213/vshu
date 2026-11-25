import { BotsDisabledError, isBotsEnabled } from '../../shared/bots-switch'
import { VSHU_CLOUD_TEAM_POLICY_FLAGS } from '../../shared/vshu-profiles/vshu-cloud-team-policy'
import { isTeamFeatureBlocked } from '../vshu-profiles/cloud-auth/active-team-capabilities'

export const BOTS_BLOCKED_BY_TEAM = 'Bots are turned off by your team.'

export function botsBlockedByTeam(): boolean {
  return isTeamFeatureBlocked(VSHU_CLOUD_TEAM_POLICY_FLAGS.bots)
}

export function areHostBotsEnabled(settings: Parameters<typeof isBotsEnabled>[0]): boolean {
  return isBotsEnabled(settings) && !botsBlockedByTeam()
}

export function assertTeamAllowsBots(): void {
  if (botsBlockedByTeam()) {
    throw new BotsDisabledError(BOTS_BLOCKED_BY_TEAM)
  }
}

export function assertHostBotsEnabled(settings: Parameters<typeof isBotsEnabled>[0]): void {
  assertTeamAllowsBots()
  if (!isBotsEnabled(settings)) {
    throw new BotsDisabledError()
  }
}
