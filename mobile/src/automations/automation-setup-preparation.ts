import { EMPTY_VSHU_HOOK_CONTENT_HASH } from '../../../src/shared/hashing/vshu-hook-content-hash'
import { isVshuHookRepoTrusted } from '../../../src/shared/workspace-setup/hooks/vshu-hook-trust-entries'
import {
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../src/shared/execution-host/execution-host'
import { findAutomationRepo } from '../../../src/shared/automations/ownership/automation-repo-target'
import { getAutomationSetupDefaultDecision } from '../../../src/shared/automations/launch/automation-setup-decision'
import type { PersistedTrustedVshuHooks } from '../../../src/shared/workspace-setup/vshu-yaml-hook-types'
import {
  newWorkspaceSetupHooksRead,
  newWorkspaceUiStateRead
} from '../new-workspace/creation/runtime/new-workspace-operations'
import type { VshuHookTrustPrompt } from '../components/hook-trust/VshuHookTrustDrawer'
import { newTabRepoListRead } from '../session/agent-launch/mobile-runtime-repo-operations'
import {
  isVshuHookTrusted,
  normalizeSetupHookTrust,
  readRepoHooksSetupCommand,
  usesVersionedVshuHookTrust,
  wasVshuHookPreviouslyApproved
} from '../new-workspace/creation/setup-hook-trust'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import type { AutomationDraft } from './automation-draft'
import { automationSetupRedecided } from './automation-setup-redecision'
import { AutomationDraftValidationError } from './automation-error'
import {
  automationRepoSchema,
  automationSetupKey,
  type AutomationTargets
} from './automation-target-inventory'

export async function prepareAutomationSetup(args: {
  client: RpcClient
  executionHost?: ExecutionHostId
  draft: AutomationDraft
  original?: AutomationDraft
  targets: AutomationTargets
  current: () => boolean
  confirm: (
    prompt: VshuHookTrustPrompt,
    trust: PersistedTrustedVshuHooks,
    repos: readonly { id: string }[]
  ) => Promise<'run' | 'skip' | null>
}): Promise<AutomationDraft | null> {
  const { client, draft, original, targets, current } = args
  if (original && !automationSetupRedecided(draft, original)) {
    return draft
  }
  if (draft.workspaceMode !== 'new_per_run') {
    return { ...draft, setupDecision: 'inherit' }
  }
  if (draft.setupDecision === 'skip') {
    return draft
  }
  const setup = targets.setups.find((entry) => automationSetupKey(entry) === draft.setupId)
  if (!setup) {
    throw new AutomationDraftValidationError('project')
  }
  let rawRepos: ReturnType<typeof newTabRepoListRead.interpret>
  try {
    rawRepos = newTabRepoListRead.interpret(await newTabRepoListRead.request(client))
  } catch {
    return current() ? { ...draft, setupDecision: 'skip' } : null
  }
  if (!current()) {
    return null
  }
  // repo.hooks accepts only an id selector; prove it cannot inspect a same-id twin.
  const candidates = rawRepos.filter((repo) => repo.id === setup.repoId)
  const parsed = automationRepoSchema.safeParse(candidates.length === 1 ? candidates[0] : null)
  const repos = parsed.success ? [parsed.data] : []
  if (!findAutomationRepo(repos, setup.repoId, setup)) {
    throw new AutomationDraftValidationError('project')
  }
  let details: ReturnType<typeof newWorkspaceSetupHooksRead.interpret>
  try {
    details = newWorkspaceSetupHooksRead.interpret(
      await newWorkspaceSetupHooksRead.request(client, {
        repo: `id:${setup.repoId}`,
        // Runs create from the automation's base branch, so its setup is what a pin must match.
        createSource: { kind: 'base', baseBranch: draft.baseBranch || undefined }
      })
    )
  } catch {
    return current() ? { ...draft, setupDecision: 'skip' } : null
  }
  if (!current()) {
    return null
  }
  if (!details.accepted) {
    return { ...draft, setupDecision: 'skip' }
  }
  const decision =
    draft.setupDecision === 'inherit'
      ? getAutomationSetupDefaultDecision({
          setupRunPolicy: details.value.setupRunPolicy ?? 'run-by-default'
        })
      : draft.setupDecision
  const runtimeHost = parseExecutionHostId(args.executionHost)?.kind === 'runtime'
  const setupTrust = normalizeSetupHookTrust(details.value.setupTrust)
  // Hosts that read no hooks here (SSH, another host's folder) omit setupConfig; nothing can be pinned.
  const pinsEmptySetup = !setupTrust && details.value.setupConfig !== undefined
  if (decision !== 'run' || (!setupTrust && !pinsEmptySetup)) {
    return readRepoHooksSetupCommand(details.value)
      ? { ...draft, setupDecision: decision ?? 'inherit', setupTrustHash: undefined }
      : { ...draft, setupDecision: 'inherit', setupTrustHash: undefined }
  }
  // Trust can only be saved on a paired desktop; a runtime host never trusts the repo.
  let trust: PersistedTrustedVshuHooks = {}
  if (!runtimeHost) {
    try {
      const reply = newWorkspaceUiStateRead.interpret(await newWorkspaceUiStateRead.request(client))
      if (reply.accepted) {
        trust = reply.value?.trustedVshuHooks ?? {}
      }
    } catch {
      // An unreadable approval record grants no trust.
    }
    if (!current()) {
      return null
    }
  }
  if (!setupTrust) {
    // As desktop: approving no shared setup in an untrusted repo pins empty content, so setup the base
    // branch adds later is skipped for review instead of running unseen.
    if (isVshuHookRepoTrusted(trust, repos, setup.repoId)) {
      return readRepoHooksSetupCommand(details.value)
        ? { ...draft, setupDecision: 'run', setupTrustHash: undefined }
        : { ...draft, setupDecision: 'inherit', setupTrustHash: undefined }
    }
    return { ...draft, setupDecision: 'run', setupTrustHash: EMPTY_VSHU_HOOK_CONTENT_HASH }
  }
  if (isVshuHookTrusted(trust, repos, setup.repoId, 'setup', setupTrust.contentHash)) {
    return { ...draft, setupDecision: 'run', setupTrustHash: undefined }
  }
  const approved = await args.confirm(
    {
      kind: 'setup',
      repoId: setup.repoId,
      repoName: setup.displayName,
      ...setupTrust,
      previouslyApproved: wasVshuHookPreviouslyApproved(trust, setup.repoId, 'setup'),
      versionOnly: usesVersionedVshuHookTrust(repos, setup.repoId)
    },
    trust,
    repos
  )
  if (!approved || !current()) {
    return null
  }
  // A runtime host can't save repo trust, so later runs may only run the content approved here.
  return approved === 'run' && runtimeHost
    ? { ...draft, setupDecision: 'run', setupTrustHash: setupTrust.contentHash }
    : { ...draft, setupDecision: approved, setupTrustHash: undefined }
}
