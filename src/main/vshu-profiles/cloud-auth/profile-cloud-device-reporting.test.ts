import { afterEach, expect, it, vi } from 'vitest'
import type { VshuCloudCapabilities } from '../../../shared/vshu-profiles/vshu-cloud-capabilities'
import type { VshuCloudSession } from '../cloud-session/profile-cloud-session-store'
import { getVshuCloudAuthConfig } from './profile-cloud-auth-config'
import {
  refreshVshuCloudCapabilities,
  refreshVshuCloudSession,
  uploadDesktopReportAfterCapabilityRefresh
} from './profile-cloud-client'

vi.mock('../../../shared/app-lifecycle/app-environment', () => ({
  hasAppEnvironment: () => true,
  getAppEnvironment: () => ({ getVersion: () => '4.2.0' })
}))
vi.mock('../../plugins/catalog/required-plugin-failures', () => ({
  getRequiredPluginFailureHeader: () => 'acme.theme'
}))

afterEach(() => vi.unstubAllGlobals())

it('keeps device data off authorization requests and only uploads after fresh opt-in', async () => {
  const configState = getVshuCloudAuthConfig(
    { VSHU_CLOUD_API_URL: 'https://auth.example.test', VSHU_CLOUD_CLIENT_ID: 'vshu-desktop' },
    false
  )
  if (!configState.configured) {
    throw new Error('Missing fixture config')
  }
  const { config } = configState
  const optedIn: VshuCloudCapabilities = {
    flags: { team_settings: true, 'desktop.deviceReporting': true },
    refreshedAt: 1,
    teamPolicy: { orgIds: ['org_team'], reportingOrgIds: ['org_team'] }
  }
  const session: VshuCloudSession = {
    accessToken: 'fixture-access',
    refreshToken: 'fixture-refresh',
    expiresAt: 10_000,
    capabilities: optedIn
  }
  const cloud = { cloudProfileId: 'desktop', userId: 'member', email: 'member@example.test' }
  const sent: Headers[] = []
  let capabilities: VshuCloudCapabilities = optedIn
  vi.stubGlobal('fetch', async (_url: string, request: RequestInit) => {
    sent.push(new Headers(request.headers))
    return Response.json({ ...session, cloud, capabilities })
  })

  await refreshVshuCloudSession(config, session)
  for (const teamPolicy of [
    undefined,
    { orgIds: ['org_team'] },
    { orgIds: ['org_team'], reportingOrgIds: [] }
  ]) {
    capabilities = teamPolicy ? { ...optedIn, teamPolicy } : { flags: {}, refreshedAt: 2 }
    const fresh = await refreshVshuCloudCapabilities(config, session)
    await uploadDesktopReportAfterCapabilityRefresh(config, session, fresh.capabilities)
  }
  capabilities = { ...optedIn, flags: { team_settings: true } }
  const legacy = await refreshVshuCloudCapabilities(config, session)
  await uploadDesktopReportAfterCapabilityRefresh(config, session, legacy.capabilities)
  expect(sent).toHaveLength(5)
  for (const headers of sent) {
    expect(headers.has('x-vshu-client')).toBe(false)
    expect(headers.has('x-vshu-app-version')).toBe(false)
    expect(headers.has('x-vshu-required-plugin-failures')).toBe(false)
  }

  capabilities = optedIn
  const fresh = await refreshVshuCloudCapabilities(config, session)
  await uploadDesktopReportAfterCapabilityRefresh(config, session, fresh.capabilities)
  expect(sent).toHaveLength(7)
  const [authorizationCheck, report] = sent.slice(5)
  expect(authorizationCheck?.has('x-vshu-client')).toBe(false)
  expect(report?.get('x-vshu-client')).toMatch(/^v=4\.2\.0; os=/)
  expect(report?.get('x-vshu-required-plugin-failures')).toBe('acme.theme')
  expect(report?.get('authorization')).toBe('Bearer fixture-access')
})
