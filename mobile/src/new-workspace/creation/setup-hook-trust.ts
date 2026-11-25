import type { PersistedTrustedVshuHooks } from '../../../../src/shared/workspace-setup/vshu-yaml-hook-types'
import {
  isVshuHookContentApproved,
  isVshuHookRepoIdOnSeveralHosts,
  isVshuHookRepoTrusted,
  type VshuHookTrustKind,
  withVshuHookRepoAlwaysTrusted,
  withVshuHookScriptConfirmed
} from '../../../../src/shared/workspace-setup/hooks/vshu-hook-trust-entries'
import { EMPTY_VSHU_HOOK_CONTENT_HASH } from '../../../../src/shared/hashing/vshu-hook-content-hash'
import type { SetupHooksCreateSource } from '../../../../src/shared/worktree/setup-hooks-create-source'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import type { VshuHookTrustPrompt } from '../../components/hook-trust/VshuHookTrustDrawer'
import { taskUiStateWrite } from '../../tasks/screen-state/mobile-task-runtime-operations'
import { repoSetupHooksRead } from './mobile-workspace-source-operations'

export type SetupHookTrust = {
  contentHash: string
  scriptContent: string
}

/** Same-id repos on several hosts keep per-version approvals; an unknown repo list can't rule that out. */
export function usesVersionedVshuHookTrust(
  repos: readonly { id: string }[] | null,
  repoId: string
): boolean {
  return !repos || isVshuHookRepoIdOnSeveralHosts(repos, repoId)
}

export function isVshuHookTrusted(
  trust: PersistedTrustedVshuHooks,
  repos: readonly { id: string }[] | null,
  repoId: string,
  kind: VshuHookTrustKind,
  contentHash: string
): boolean {
  return (
    (repos !== null && isVshuHookRepoTrusted(trust, repos, repoId)) ||
    isVshuHookContentApproved(trust, repoId, kind, contentHash)
  )
}

export function wasVshuHookPreviouslyApproved(
  trust: PersistedTrustedVshuHooks,
  repoId: string,
  kind: VshuHookTrustKind
): boolean {
  return Boolean(trust[repoId]?.[kind]?.contentHash)
}

/** Setup may run unless skipped: explicitly, or by inheriting the project's run-by-default policy. */
export function createMayRunSetup(
  decision: 'inherit' | 'run' | 'skip',
  runPolicy: 'ask' | 'run-by-default' | 'skip-by-default' | undefined
): boolean {
  return decision === 'run' || (decision === 'inherit' && runPolicy !== 'skip-by-default')
}

/** Whether a create's setup needs a trust check. One landing in another repo is checked unless skipped, as the selected repo's policy says nothing about it. */
export function createSetupNeedsTrustCheck(args: {
  sameRepo: boolean
  decision: 'inherit' | 'run' | 'skip'
  runPolicy: 'ask' | 'run-by-default' | 'skip-by-default' | undefined
}): boolean {
  return args.sameRepo ? createMayRunSetup(args.decision, args.runPolicy) : args.decision !== 'skip'
}

/** What a create sends once its setup is approved: a hash pins the run to the shown content. */
export type CreateSetupApproval = { approvedSetupHash?: string }

/** Approves a create's setup without asking, or returns a prompt with the setup of the ref it checks out. */
export async function resolveCreateSetupApproval(args: {
  client: RpcClient
  trust: PersistedTrustedVshuHooks
  repos: readonly { id: string }[]
  repo: { id: string; displayName: string }
  createSource: SetupHooksCreateSource
}): Promise<{ approved: CreateSetupApproval } | { ask: VshuHookTrustPrompt }> {
  const repoId = args.repo.id
  if (isVshuHookRepoTrusted(args.trust, args.repos, repoId)) {
    return { approved: {} }
  }
  // Older hosts ignore createSource and report the project checkout's setup.
  const reply = repoSetupHooksRead.interpret(
    await repoSetupHooksRead.request(args.client, {
      repo: `id:${repoId}`,
      createSource: args.createSource
    })
  )
  const setupTrust = normalizeSetupHookTrust(reply.setupTrust)
  if (!setupTrust) {
    // As desktop: approving no shared setup pins empty content, so setup the created branch adds is re-asked.
    // Hosts that didn't read hooks here (SSH, another host's folder) omit setupConfig and can't recover it.
    return {
      approved:
        reply.setupConfig === undefined ? {} : { approvedSetupHash: EMPTY_VSHU_HOOK_CONTENT_HASH }
    }
  }
  if (isVshuHookContentApproved(args.trust, repoId, 'setup', setupTrust.contentHash)) {
    return { approved: { approvedSetupHash: setupTrust.contentHash } }
  }
  return {
    ask: {
      kind: 'setup',
      repoId,
      repoName: args.repo.displayName,
      scriptContent: setupTrust.scriptContent,
      contentHash: setupTrust.contentHash,
      previouslyApproved: wasVshuHookPreviouslyApproved(args.trust, repoId, 'setup'),
      versionOnly: usesVersionedVshuHookTrust(args.repos, repoId)
    }
  }
}

/** Repo trust runs any content; otherwise the host runs only the shown content. */
export function approvedCreateSetup(
  repos: readonly { id: string }[] | null,
  prompt: Pick<VshuHookTrustPrompt, 'repoId' | 'contentHash'>,
  alwaysTrust: boolean
): CreateSetupApproval {
  return alwaysTrust && !usesVersionedVshuHookTrust(repos, prompt.repoId)
    ? {}
    : { approvedSetupHash: prompt.contentHash }
}

type HookTrustApproval = {
  client: RpcClient
  trust: PersistedTrustedVshuHooks
  repos: readonly { id: string }[] | null
  repoId: string
  contentHash: string
  alwaysTrust: boolean
}

/** Run once stores nothing and Always trust stores repo trust; same-id repos also keep this version. */
export async function persistVshuHookTrustApproval(
  args: HookTrustApproval & { kind: VshuHookTrustKind }
): Promise<PersistedTrustedVshuHooks> {
  const confirmed = usesVersionedVshuHookTrust(args.repos, args.repoId)
    ? withVshuHookScriptConfirmed(args.trust, args.repoId, args.kind, args.contentHash)
    : args.trust
  const next = args.alwaysTrust ? withVshuHookRepoAlwaysTrusted(confirmed, args.repoId) : confirmed
  if (next !== args.trust) {
    taskUiStateWrite.interpret(
      await taskUiStateWrite.request(args.client, { trustedVshuHooks: next })
    )
  }
  return next
}

export function persistSetupHookTrustApproval(
  args: HookTrustApproval
): Promise<PersistedTrustedVshuHooks> {
  return persistVshuHookTrustApproval({ ...args, kind: 'setup' })
}

// Hooks may omit setupTrust; validate the pair here while preserving other host fields.
export function normalizeSetupHookTrust(
  setupTrust: { contentHash?: string; scriptContent?: string } | null | undefined
): SetupHookTrust | null {
  const contentHash = setupTrust?.contentHash
  const scriptContent = setupTrust?.scriptContent
  if (!contentHash || !scriptContent) {
    return null
  }
  return { ...setupTrust, contentHash, scriptContent }
}

// New hosts send setupConfig (vshu.yaml setup plus defaultTabs commands); older ones only the effective setup script.
export function readRepoHooksSetupCommand(reply: {
  hooks?: { scripts?: { setup?: string } } | null
  setupConfig?: { command: string } | null
}): string | null {
  if (reply.setupConfig !== undefined) {
    return reply.setupConfig?.command.trim() || null
  }
  return reply.hooks?.scripts?.setup?.trim() || null
}
