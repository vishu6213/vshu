import { getSecretStore, type SecretStore } from '../../../shared/secure-storage/secret-store'
import { allowsPlaintextVshuCloudSession } from '../cloud-auth/profile-cloud-auth-config'
import type { VshuCloudSession, VshuCloudSessionReadResult } from './profile-cloud-session-store'
import type { VshuCloudOrgSummary } from '../../../shared/vshu-profiles/vshu-profiles'

// vshud's host-key seal gets its own tag so a data folder shared with a desktop fails clearly, not as a decrypt error.
type SealedSessionFormat = 'electron-safe-storage-v1' | 'vshud-host-key-v1'

export function sealedSessionFormat(secrets: SecretStore): SealedSessionFormat {
  return secrets.describeSealing?.().kind === 'host-key'
    ? 'vshud-host-key-v1'
    : 'electron-safe-storage-v1'
}

export type PersistedEncryptedSession = {
  version: 1
  format: SealedSessionFormat
  savedAt: number
  ciphertext: string
}

export type PersistedPlaintextSession = {
  version: 1
  format: 'dev-plaintext-v1'
  savedAt: number
  session: VshuCloudSession
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVshuCloudSession(value: unknown): value is VshuCloudSession {
  if (!isObject(value) || !isObject(value.capabilities) || !isObject(value.capabilities.flags)) {
    return false
  }
  if (value.organizations !== undefined && !isVshuCloudOrganizations(value.organizations)) {
    return false
  }
  if (
    value.identity !== undefined &&
    !(
      isObject(value.identity) &&
      typeof value.identity.userId === 'string' &&
      typeof value.identity.cloudProfileId === 'string'
    )
  ) {
    return false
  }
  return (
    typeof value.accessToken === 'string' &&
    value.accessToken.length > 0 &&
    typeof value.refreshToken === 'string' &&
    value.refreshToken.length > 0 &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt) &&
    typeof value.capabilities.refreshedAt === 'number' &&
    Number.isFinite(value.capabilities.refreshedAt)
  )
}

function isVshuCloudOrganizations(value: unknown): value is VshuCloudOrgSummary[] {
  if (!Array.isArray(value)) {
    return false
  }
  return value.every((organization) => {
    if (!isObject(organization)) {
      return false
    }
    return (
      typeof organization.orgId === 'string' &&
      organization.orgId.length > 0 &&
      typeof organization.name === 'string' &&
      organization.name.length > 0 &&
      (organization.role === undefined || typeof organization.role === 'string')
    )
  })
}

export function decodeStoredVshuCloudSession(contents: string): VshuCloudSessionReadResult {
  const parsed: unknown = JSON.parse(contents)
  if (!isObject(parsed) || parsed.version !== 1) {
    return { status: 'decrypt-failed', persistence: 'none', error: 'Unsupported session format.' }
  }
  if (parsed.format === 'electron-safe-storage-v1' || parsed.format === 'vshud-host-key-v1') {
    const secrets = getSecretStore()
    if (parsed.format !== sealedSessionFormat(secrets)) {
      return {
        status: 'decrypt-failed',
        persistence: 'none',
        error:
          parsed.format === 'vshud-host-key-v1'
            ? "This Vshu account sign-in was saved by Vshu's headless server. Sign in again here."
            : 'This Vshu account sign-in was saved by the Vshu app. Sign in again on this server.'
      }
    }
    if (!secrets.isEncryptionAvailable()) {
      return {
        status: 'decrypt-failed',
        persistence: 'none',
        error: 'OS-backed encryption is unavailable.'
      }
    }
    if (typeof parsed.ciphertext !== 'string') {
      return { status: 'decrypt-failed', persistence: 'none', error: 'Invalid saved session.' }
    }
    const decrypted = secrets.decryptString(Buffer.from(parsed.ciphertext, 'base64'))
    const session: unknown = JSON.parse(decrypted)
    if (!isVshuCloudSession(session)) {
      return { status: 'decrypt-failed', persistence: 'none', error: 'Invalid saved session.' }
    }
    return { status: 'found', session, persistence: 'encrypted' }
  }
  if (parsed.format === 'dev-plaintext-v1' && allowsPlaintextVshuCloudSession()) {
    if (!isVshuCloudSession(parsed.session)) {
      return { status: 'decrypt-failed', persistence: 'none', error: 'Invalid saved session.' }
    }
    return { status: 'found', session: parsed.session, persistence: 'dev-plaintext' }
  }
  return { status: 'decrypt-failed', persistence: 'none', error: 'Unsafe session format.' }
}
