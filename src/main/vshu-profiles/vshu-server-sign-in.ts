import {
  VSHU_ACCOUNT_APPROVE_IN_BROWSER_RUNTIME_CAPABILITY,
  VSHU_ACCOUNT_SERVER_SIGN_IN_RUNTIME_CAPABILITY
} from '../../shared/vshu-account-runtime-capabilities'
import {
  isVshuAccountApprovalPrompt,
  type VshuAccountServerStatus,
  type VshuAccountSignInIntent,
  type VshuAccountSignInPrompt,
  type VshuAccountSignInStatus
} from '../../shared/vshu-account-server-sign-in'
import { CallerOwnedSignInFlows } from '../runtime/caller-owned-sign-in-flows'
import { readVshuAccountStorage, toServerStatus } from './vshu-account-server-status'
import { onVshuCloudSessionInvalidated } from './cloud-session/profile-cloud-session-invalidation'
import {
  intentOf,
  runServerSignIn,
  type VshuServerSignInDeps,
  type SignInCode,
  type SignInProvider,
  type SignInResult
} from './vshu-server-sign-in-run'

export type { VshuServerSignInDeps } from './vshu-server-sign-in-run'

const DAILY_REFRESH_MS = 24 * 60 * 60 * 1000
const MAX_ERROR_CHARS = 600

/** Lets a client that can run commands on this host sign its Vshu account in or out.
 * The host makes and keeps the PKCE verifier; the client only relays the one-time code. */
export class VshuServerSignIn {
  private readonly flows: CallerOwnedSignInFlows<
    SignInProvider,
    VshuAccountSignInPrompt,
    SignInCode,
    SignInResult
  >
  private readonly listeners = new Set<(status: VshuAccountServerStatus) => void>()
  private readonly stopInvalidation: () => void
  private dailyRefresh: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: VshuServerSignInDeps) {
    this.flows = new CallerOwnedSignInFlows(
      (provider, channel) => runServerSignIn(this.deps, provider, channel, () => this.publish()),
      {
        acceptsPrompt: () => true,
        // An approve-in-browser flow finishes from Vshu Cloud; nothing is pasted into it.
        acceptsCode: (prompt) => prompt !== undefined && !isVshuAccountApprovalPrompt(prompt),
        describeFailure: (message) => ({
          error:
            message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}…` : message
        }),
        busyMessage: 'Another device is signing this server in. Finish or cancel it there first.',
        // Newest wins: a browser page another device left open never blocks signing in from here.
        supersedes: (running, next) =>
          running.provider.endsWith(':approve') &&
          running.phase === 'waiting' &&
          next.endsWith(':approve')
      }
    )
    const stopInvalidation = onVshuCloudSessionInvalidated(() => this.publish())
    // The desktop window signs out through the account service directly, not through signOut() here.
    const stopSignOutWatch = deps.account.onSignOutStarted?.(() => this.cancelActive())
    this.stopInvalidation = () => {
      stopInvalidation()
      stopSignOutWatch?.()
    }
  }

  status(): VshuAccountServerStatus {
    return toServerStatus(this.deps.account.getAuthStatus(), readVshuAccountStorage())
  }

  onChanged(listener: (status: VshuAccountServerStatus) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  startSignIn(
    owner: string,
    intent: VshuAccountSignInIntent,
    options: { approveInBrowser?: boolean } = {}
  ): VshuAccountSignInStatus {
    return toWire(this.flows.start(owner, options.approveInBrowser ? `${intent}:approve` : intent))
  }

  async waitSignIn(
    owner: string,
    flowId: string,
    afterRevision: number,
    signal?: AbortSignal
  ): Promise<VshuAccountSignInStatus> {
    return toWire(await this.flows.wait(owner, flowId, afterRevision, signal))
  }

  completeSignIn(owner: string, flowId: string, code: SignInCode): VshuAccountSignInStatus {
    return toWire(this.flows.submitCode(owner, flowId, code))
  }

  async cancelSignIn(owner: string, flowId: string): Promise<VshuAccountSignInStatus> {
    return toWire(await this.flows.cancel(owner, flowId))
  }

  async selectOrg(orgId: string): Promise<VshuAccountServerStatus> {
    const result = await this.deps.account.selectOrg(orgId)
    if (result.status === 'failed') {
      throw new Error(result.error)
    }
    if (result.status !== 'selected') {
      throw new Error('Sign this server in again to change its organization.')
    }
    return this.publish()
  }

  private cancelActive(): void {
    const pending = this.flows.activeFlow()
    if (pending) {
      void this.flows.cancel(pending.owner, pending.flowId)
    }
  }

  async signOut(): Promise<VshuAccountServerStatus> {
    // A sign-in still waiting for its code must not land after the sign-out.
    const pending = this.flows.activeFlow()
    if (pending) {
      await this.flows.cancel(pending.owner, pending.flowId)
    }
    await this.deps.account.signOut()
    console.info('[vshu-account] Signed out')
    return this.publish()
  }

  /** Keeps an idle server's 30-day sliding session alive; a busy one refreshes on demand anyway. */
  startDailyRefresh(): void {
    if (this.dailyRefresh) {
      return
    }
    this.dailyRefresh = setInterval(() => void this.refreshIfSignedIn(), DAILY_REFRESH_MS)
    this.dailyRefresh.unref?.()
  }

  async refreshIfSignedIn(): Promise<void> {
    if (this.deps.account.getAuthStatus().state !== 'connected') {
      return
    }
    const result = await this.deps.account.refreshAuth().catch(() => null)
    if (result?.status === 'reconnect-required') {
      console.info('[vshu-account] Session expired; sign in again')
      this.publish()
    }
  }

  dispose(): void {
    if (this.dailyRefresh) {
      clearInterval(this.dailyRefresh)
      this.dailyRefresh = null
    }
    this.stopInvalidation()
    this.listeners.clear()
  }

  private publish(): VshuAccountServerStatus {
    const status = this.status()
    for (const listener of this.listeners) {
      listener(status)
    }
    return status
  }
}

function toWire(
  status: Omit<VshuAccountSignInStatus, 'provider'> & { provider: SignInProvider }
): VshuAccountSignInStatus {
  return { ...status, provider: intentOf(status.provider) }
}

let installed: VshuServerSignIn | null = null

/** One account per host process; the runtime advertises the capability only once installed. */
export function installVshuServerSignIn(server: VshuServerSignIn | null): void {
  installed?.dispose()
  installed = server
}

export function getVshuServerSignIn(): VshuServerSignIn | null {
  return installed
}

/** Only a host that installed its account sign-in can be signed in by a client. */
export function vshuAccountRuntimeCapabilities(): string[] {
  return installed
    ? [
        VSHU_ACCOUNT_SERVER_SIGN_IN_RUNTIME_CAPABILITY,
        VSHU_ACCOUNT_APPROVE_IN_BROWSER_RUNTIME_CAPABILITY
      ]
    : []
}
