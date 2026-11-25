import { VshuAccountService } from '../vshu-profiles/vshu-account-service'
import { botAccountSwitchBlocker } from '../bots/bot-account-switch-blocker'
import { mainProcessConnectorCloud } from './cloud-startup/main-process-connector-startup'
import { mainProcessState as state } from './main-process-state'
import { redeclarePairedDesktopAccounts } from '../ipc/runtime-environments/connections/runtime-environment-request-connections'
import { scheduleTeamPolicyRefresh } from '../vshu-profiles/cloud-auth/team-policy-refresh'

export function createDesktopVshuAccountService(
  openBrowser: (url: string) => Promise<void>
): VshuAccountService {
  const account = new VshuAccountService({
    openBrowser,
    accountBoundLinks: botAccountSwitchBlocker({
      bots: () => state.core.runtime?.bots ?? null,
      profileId: () => state.activeVshuProfile?.profile.id ?? null
    }),
    hooks: {
      onAuthMutation: () => {
        // An auth change retries relay installation after launch-time failure.
        state.core.relayHost?.accountChanged()
        mainProcessConnectorCloud()?.accountChanged()
        redeclarePairedDesktopAccounts()
      },
      onSignedIn: () => mainProcessConnectorCloud()?.signedIn(),
      // Only sign-out fences paired phones; reasonless quit/relaunch must not look like logout.
      onBeforeSignOut: () => {
        state.core.relayHost?.signOutStarted()
        mainProcessConnectorCloud()?.signOutStarted()
      },
      onAfterSignOut: () => {
        mainProcessConnectorCloud()?.signOutFinished()
        redeclarePairedDesktopAccounts()
      }
    }
  })
  state.core.stopTeamPolicyRefresh?.()
  state.core.stopTeamPolicyRefresh = scheduleTeamPolicyRefresh(account)
  return account
}
