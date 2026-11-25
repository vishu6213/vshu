import type {
  VshuCloudCapabilities,
  VshuCloudOrgSummary,
  VshuProfileCloudSummary
} from '../../../shared/vshu-profiles/vshu-profiles'

export type VshuCloudSessionExchangeResponse = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  cloud: VshuProfileCloudSummary
  organizations?: VshuCloudOrgSummary[]
  capabilities: VshuCloudCapabilities
}
