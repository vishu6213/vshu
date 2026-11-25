import { defineMethod, defineStreamingMethod, type RpcContext } from '../core'
import { rpcCallerOperationKey } from '../callers/rpc-caller-identity'
import {
  getVshuServerSignIn,
  type VshuServerSignIn
} from '../../../vshu-profiles/vshu-server-sign-in'
import {
  VshuAccountSelectOrgParams,
  VshuAccountSignInCompleteParams,
  VshuAccountSignInFlowParams,
  VshuAccountSignInStartParams,
  VshuAccountSignInWaitParams,
  VshuAccountUnsubscribeParams
} from '../../../../shared/rpc-contract/vshu-account-params'

// Per-process counter: same-millisecond subscriptions must not evict each other's cleanup.
let subscriptionSeq = 0

function server(): VshuServerSignIn {
  const installed = getVshuServerSignIn()
  if (!installed) {
    throw new Error('Signing in to Vshu is not available on this host. Update Vshu on it.')
  }
  return installed
}

function flowOwner({ caller }: Pick<RpcContext, 'caller'>): string {
  if (!caller) {
    throw new Error('This client cannot sign this host in.')
  }
  return rpcCallerOperationKey(caller)
}

// `workspace`: anyone who can run commands here could run the sign-in in a terminal anyway.
export const VSHU_ACCOUNT_METHODS = [
  defineMethod({
    name: 'vshuAccount.status',
    permission: 'workspace',
    params: null,
    handler: async () => server().status()
  }),
  defineMethod({
    name: 'vshuAccount.signIn.start',
    permission: 'workspace',
    params: VshuAccountSignInStartParams,
    handler: async ({ switchAccount, approveInBrowser }, ctx) =>
      server().startSignIn(flowOwner(ctx), switchAccount ? 'switch-account' : 'sign-in', {
        approveInBrowser
      })
  }),
  defineMethod({
    name: 'vshuAccount.signIn.wait',
    permission: 'workspace',
    params: VshuAccountSignInWaitParams,
    handler: async ({ flowId, afterRevision }, ctx) =>
      server().waitSignIn(flowOwner(ctx), flowId, afterRevision, ctx.signal)
  }),
  defineMethod({
    name: 'vshuAccount.signIn.complete',
    permission: 'workspace',
    params: VshuAccountSignInCompleteParams,
    handler: async ({ flowId, code, state, redirectUri }, ctx) =>
      server().completeSignIn(flowOwner(ctx), flowId, { code, state, redirectUri })
  }),
  defineMethod({
    name: 'vshuAccount.signIn.cancel',
    permission: 'workspace',
    params: VshuAccountSignInFlowParams,
    handler: async ({ flowId }, ctx) => server().cancelSignIn(flowOwner(ctx), flowId)
  }),
  defineMethod({
    name: 'vshuAccount.selectOrg',
    permission: 'workspace',
    params: VshuAccountSelectOrgParams,
    handler: async ({ orgId }) => server().selectOrg(orgId)
  }),
  defineMethod({
    name: 'vshuAccount.signOut',
    permission: 'workspace',
    params: null,
    handler: async () => server().signOut()
  }),
  defineStreamingMethod({
    name: 'vshuAccount.subscribe',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime, connectionId }, emit) => {
      const account = server()
      await new Promise<void>((resolve) => {
        const unsubscribe = account.onChanged((status) => emit({ type: 'status', status }))
        const subscriptionId = `vshu-account-${connectionId ?? 'inproc'}-${++subscriptionSeq}`
        runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            unsubscribe()
            emit({ type: 'end' })
            resolve()
          },
          connectionId
        )
        emit({ type: 'ready', subscriptionId, status: account.status() })
      })
    }
  }),
  defineMethod({
    name: 'vshuAccount.unsubscribe',
    permission: 'workspace',
    params: VshuAccountUnsubscribeParams,
    handler: async ({ subscriptionId }, { runtime }) => {
      runtime.cleanupSubscription(subscriptionId)
      return { unsubscribed: true }
    }
  })
]
