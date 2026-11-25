import { cleanCloudServiceOrigin } from '../../../shared/network/cloud-service-url'
import { collectAuthorizedDesktopReport } from './desktop-client-report'
import type {
  VshuCloudCapabilities,
  VshuCloudOrgSummary,
  VshuProfileCloudSummary
} from '../../../shared/vshu-profiles/vshu-profiles'
import {
  VSHU_CLOUD_TEAM_SETTINGS,
  vshuCloudTeamPolicySchema
} from '../../../shared/vshu-profiles/vshu-cloud-team-policy'
import type { VshuCloudAuthConfig } from './profile-cloud-auth-config'
import type { VshuCloudSession } from '../cloud-session/profile-cloud-session-store'
import type { VshuCloudSessionExchangeResponse } from '../cloud-session/profile-cloud-session-exchange'
import { cancelUnreadResponseBody } from '../../lib/unread-response-body'

type ExchangeCodeArgs = {
  code: string
  codeVerifier: string
  nonce: string
  redirectUri: string
  state: string
  localProfileId: string
}

type CreateCloudProfileArgs = {
  orgId?: string
  name?: string
}

type SelectOrgResponse = {
  cloud: VshuProfileCloudSummary
  organizations?: VshuCloudOrgSummary[]
  capabilities: VshuCloudCapabilities
}

type CapabilityRefreshResponse = {
  cloud?: VshuProfileCloudSummary
  organizations?: VshuCloudOrgSummary[]
  capabilities: VshuCloudCapabilities
}

export class VshuCloudRequestError extends Error {
  // Preserve the server error discriminator so callers can distinguish business 4xx outcomes.
  constructor(
    public readonly statusCode: number,
    public readonly errorCode?: string
  ) {
    super(`vshu_cloud_request_failed_${statusCode}`)
    this.name = 'VshuCloudRequestError'
  }
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`invalid_vshu_cloud_${field}`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`invalid_vshu_cloud_${field}`)
  }
  return trimmed
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

function assertNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`invalid_vshu_cloud_${field}`)
  }
  return value
}

function normalizeCapabilities(value: unknown): VshuCloudCapabilities {
  if (!value || typeof value !== 'object') {
    return { flags: {}, refreshedAt: Date.now() }
  }
  const record = value as Record<string, unknown>
  const rawFlags = record.flags
  const flags: Record<string, boolean> = {}
  if (rawFlags && typeof rawFlags === 'object' && !Array.isArray(rawFlags)) {
    for (const [key, flag] of Object.entries(rawFlags)) {
      if (typeof flag === 'boolean') {
        flags[key] = flag
      }
    }
  }
  const consoleOrigin =
    typeof record.consoleOrigin === 'string'
      ? cleanCloudServiceOrigin(record.consoleOrigin, false)
      : null
  const teamPolicy =
    flags[VSHU_CLOUD_TEAM_SETTINGS] === true
      ? vshuCloudTeamPolicySchema.safeParse(record.teamPolicy)
      : undefined
  return {
    flags,
    refreshedAt:
      typeof record.refreshedAt === 'number' && Number.isFinite(record.refreshedAt)
        ? record.refreshedAt
        : Date.now(),
    ...(consoleOrigin ? { consoleOrigin } : {}),
    ...(teamPolicy?.success ? { teamPolicy: teamPolicy.data } : {})
  }
}

function normalizeOrganizations(value: unknown): VshuCloudOrgSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const organizations: VshuCloudOrgSummary[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    if (typeof record.orgId !== 'string' || typeof record.name !== 'string') {
      continue
    }
    const orgId = record.orgId.trim()
    const name = record.name.trim()
    if (!orgId || !name) {
      continue
    }
    organizations.push({
      orgId,
      name,
      role: typeof record.role === 'string' && record.role.trim() ? record.role.trim() : undefined
    })
  }
  return organizations
}

function normalizeCloudSummary(value: unknown): VshuProfileCloudSummary {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid_vshu_cloud_profile')
  }
  const record = value as Record<string, unknown>
  return {
    cloudProfileId: assertString(record.cloudProfileId, 'profile_id'),
    userId: assertString(record.userId, 'user_id'),
    email: assertString(record.email, 'email'),
    displayName: optionalString(record.displayName),
    activeOrgId: optionalString(record.activeOrgId),
    activeOrgName: optionalString(record.activeOrgName),
    linkedAt:
      typeof record.linkedAt === 'number' && Number.isFinite(record.linkedAt)
        ? record.linkedAt
        : Date.now()
  }
}

function normalizeSessionResponse(value: unknown): VshuCloudSessionExchangeResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid_vshu_cloud_session')
  }
  const record = value as Record<string, unknown>
  return {
    accessToken: assertString(record.accessToken, 'access_token'),
    refreshToken: assertString(record.refreshToken, 'refresh_token'),
    expiresAt: assertNumber(record.expiresAt, 'expires_at'),
    cloud: normalizeCloudSummary(record.cloud),
    organizations: normalizeOrganizations(record.organizations),
    capabilities: normalizeCapabilities(record.capabilities)
  }
}

const CLOUD_REQUEST_TIMEOUT_MS = 30_000

// Two attempts plus the replay delay must settle inside the server's 60s rotation grace.
const CLOUD_REFRESH_TIMEOUT_MS = 20_000

type PostJsonOptions = {
  accessToken?: string
  timeoutMs?: number
  reportHeaders?: Record<string, string>
}

// Without an explicit rejection, a rotating credential may already be spent.
export function isAmbiguousCloudRequestFailure(error: unknown): boolean {
  return !(error instanceof VshuCloudRequestError)
}

// Proxies, CDNs and gateways answer with HTML; only the auth server's JSON carries a verdict.
async function readCloudErrorCode(response: Response): Promise<string | undefined> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await cancelUnreadResponseBody(response)
    return undefined
  }
  try {
    const body: unknown = await response.json()
    return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : undefined
  } catch {
    return undefined
  }
}

async function postJson<T>(url: string, body: unknown, options?: PostJsonOptions): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options?.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
      ...options?.reportHeaders
    },
    body: JSON.stringify(body),
    // Redirects could leak rotating credentials; timeout bounds renderer IPC waits.
    redirect: 'error',
    signal: AbortSignal.timeout(options?.timeoutMs ?? CLOUD_REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new VshuCloudRequestError(response.status, await readCloudErrorCode(response))
  }
  return (await response.json()) as T
}

export async function exchangeVshuCloudAuthCode(
  config: VshuCloudAuthConfig,
  args: ExchangeCodeArgs
): Promise<VshuCloudSessionExchangeResponse> {
  return normalizeSessionResponse(
    await postJson(config.sessionEndpoint, {
      code: args.code,
      codeVerifier: args.codeVerifier,
      nonce: args.nonce,
      redirectUri: args.redirectUri,
      state: args.state,
      localProfileId: args.localProfileId
    })
  )
}

export async function refreshVshuCloudCapabilities(
  config: VshuCloudAuthConfig,
  session: VshuCloudSession
): Promise<CapabilityRefreshResponse> {
  const response = await postJson<{
    cloud?: unknown
    organizations?: unknown
    capabilities: unknown
  }>(config.capabilitiesEndpoint, {}, { accessToken: session.accessToken })
  return {
    cloud: response.cloud === undefined ? undefined : normalizeCloudSummary(response.cloud),
    organizations: normalizeOrganizations(response.organizations),
    capabilities: normalizeCapabilities(response.capabilities)
  }
}

export async function uploadDesktopReportAfterCapabilityRefresh(
  config: VshuCloudAuthConfig,
  session: VshuCloudSession,
  capabilities: VshuCloudCapabilities
): Promise<void> {
  const reportHeaders = collectAuthorizedDesktopReport(capabilities, session.identity)
  if (reportHeaders) {
    await postJson(
      config.capabilitiesEndpoint,
      {},
      { accessToken: session.accessToken, reportHeaders }
    )
  }
}

export async function refreshVshuCloudSession(
  config: VshuCloudAuthConfig,
  session: VshuCloudSession
): Promise<VshuCloudSessionExchangeResponse> {
  return normalizeSessionResponse(
    await postJson(
      config.refreshEndpoint,
      { refreshToken: session.refreshToken },
      { timeoutMs: CLOUD_REFRESH_TIMEOUT_MS }
    )
  )
}

export async function createVshuCloudProfile(
  config: VshuCloudAuthConfig,
  session: VshuCloudSession,
  args: CreateCloudProfileArgs
): Promise<VshuCloudSessionExchangeResponse> {
  return normalizeSessionResponse(
    await postJson(
      config.profileEndpoint,
      // The refresh token proves the long-lived sign-in, not just a short-lived access token.
      { orgId: args.orgId, name: args.name, refreshToken: session.refreshToken },
      { accessToken: session.accessToken }
    )
  )
}

export async function selectVshuCloudOrg(
  config: VshuCloudAuthConfig,
  session: VshuCloudSession,
  orgId: string
): Promise<SelectOrgResponse> {
  const response = await postJson<{
    cloud: unknown
    organizations?: unknown
    capabilities: unknown
  }>(config.orgEndpoint, { orgId }, { accessToken: session.accessToken })
  return {
    cloud: normalizeCloudSummary(response.cloud),
    organizations: normalizeOrganizations(response.organizations),
    capabilities: normalizeCapabilities(response.capabilities)
  }
}

export async function revokeVshuCloudSession(
  config: VshuCloudAuthConfig,
  session: VshuCloudSession
): Promise<void> {
  await postJson(
    config.logoutEndpoint,
    { refreshToken: session.refreshToken },
    { accessToken: session.accessToken }
  )
}
