import type {
  PersistedTrustedVshuHookRepo,
  PersistedTrustedVshuHooks
} from '../vshu-yaml-hook-types'

export type VshuHookTrustKind = Exclude<keyof PersistedTrustedVshuHookRepo, 'all'>

const VSHU_HOOK_TRUST_KINDS = [
  'setup',
  'archive',
  'issueCommand',
  'vmRecipe'
] as const satisfies readonly VshuHookTrustKind[]

export function isVshuHookRepoIdOnSeveralHosts(
  repos: readonly { id: string }[],
  repoId: string
): boolean {
  return repos.filter((repo) => repo.id === repoId).length > 1
}

export function canUseRepoWideTrust(
  trust: PersistedTrustedVshuHooks,
  repos: readonly { id: string }[],
  repoId: string
): boolean {
  // Why: with the id on two hosts, trusting one row's script could run the other's unseen.
  return Boolean(trust[repoId]?.all) && !isVshuHookRepoIdOnSeveralHosts(repos, repoId)
}

/** Repo-wide trust; on a single host, an approval of any hook kind also trusts the repo. */
export function isVshuHookRepoTrusted(
  trust: PersistedTrustedVshuHooks,
  repos: readonly { id: string }[],
  repoId: string
): boolean {
  if (canUseRepoWideTrust(trust, repos, repoId)) {
    return true
  }
  return (
    !isVshuHookRepoIdOnSeveralHosts(repos, repoId) &&
    VSHU_HOOK_TRUST_KINDS.some(
      (kind) => approvedVshuHookContentHashes(trust, repoId, kind).length > 0
    )
  )
}

// Bounded, so a long-lived repo can't accumulate every script it ever had; large enough that
// switching between branches with different setup scripts rarely re-prompts.
export const MAX_APPROVED_VSHU_HOOK_HASHES = 20

/** Every content hash approved for this script, newest first. */
export function approvedVshuHookContentHashes(
  trust: PersistedTrustedVshuHooks,
  repoId: string,
  kind: VshuHookTrustKind
): string[] {
  const entry: unknown = trust[repoId]?.[kind]
  if (!entry || typeof entry !== 'object') {
    return []
  }
  const latest = 'contentHash' in entry ? entry.contentHash : undefined
  const previous = 'previousContentHashes' in entry ? entry.previousContentHashes : undefined
  const hashes = [latest, ...(Array.isArray(previous) ? previous : [])].filter(
    (hash): hash is string => typeof hash === 'string' && hash.length > 0 && hash.length <= 128
  )
  return [...new Set(hashes)].slice(0, MAX_APPROVED_VSHU_HOOK_HASHES)
}

export function isVshuHookContentApproved(
  trust: PersistedTrustedVshuHooks,
  repoId: string,
  kind: VshuHookTrustKind,
  contentHash: string
): boolean {
  return approvedVshuHookContentHashes(trust, repoId, kind).includes(contentHash)
}

/** Returns `trust` itself when the approval is already the latest one recorded. */
export function withVshuHookScriptConfirmed(
  trust: PersistedTrustedVshuHooks,
  repoId: string,
  kind: VshuHookTrustKind,
  contentHash: string,
  approvedAt: number = Date.now()
): PersistedTrustedVshuHooks {
  const existing = trust[repoId]
  if (existing?.[kind]?.contentHash === contentHash) {
    return trust
  }
  const previousContentHashes = approvedVshuHookContentHashes(trust, repoId, kind)
    .filter((hash) => hash !== contentHash)
    .slice(0, MAX_APPROVED_VSHU_HOOK_HASHES - 1)
  return {
    ...trust,
    [repoId]: {
      ...existing,
      [kind]: {
        contentHash,
        approvedAt,
        ...(previousContentHashes.length > 0 ? { previousContentHashes } : {})
      }
    }
  }
}

/** Returns `trust` itself when the repo is already always-trusted. */
export function withVshuHookRepoAlwaysTrusted(
  trust: PersistedTrustedVshuHooks,
  repoId: string,
  approvedAt: number = Date.now()
): PersistedTrustedVshuHooks {
  const existing = trust[repoId]
  if (existing?.all) {
    return trust
  }
  return { ...trust, [repoId]: { ...existing, all: { approvedAt } } }
}
