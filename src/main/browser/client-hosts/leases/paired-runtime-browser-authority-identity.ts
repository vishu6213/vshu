import { createHash } from 'node:crypto'
import type { PairedRuntimeConnection } from '../../../../shared/remote-runtime/pairing/paired-runtime-connection'
import type { KnownRuntimeEnvironment } from '../../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { BrowserClientPageAuthorityIdentity } from '../../client-pages/execution/browser-client-page-command-executor-dependencies'

export function derivePairedRuntimeBrowserAuthorityIdentity(input: {
  vshuProfileId: string
  environment: Pick<KnownRuntimeEnvironment, 'id' | 'vshudDeployment'>
  pairingRevision: number
  authorityRuntimeId: string
  connection: PairedRuntimeConnection
}): BrowserClientPageAuthorityIdentity {
  const { vshuProfileId, environment, pairingRevision, connection } = input
  const pairingIdentity = pairingAuthorityConnectionIdentity(
    vshuProfileId,
    environment.id,
    pairingRevision,
    connection
  )
  return {
    // Managed SSH/WSL deployments re-pair in place, so cookie storage must outlive pairing revisions.
    authorityConnectionIdentity: environment.vshudDeployment
      ? deployedAuthorityConnectionIdentity(vshuProfileId, environment.id, connection)
      : pairingIdentity,
    pairingAuthorityConnectionIdentity: pairingIdentity,
    legacyAuthorityConnectionIdentity: legacyAuthorityConnectionIdentity(
      vshuProfileId,
      environment.id,
      pairingRevision,
      input.authorityRuntimeId,
      connection
    )
  }
}

// Exclude the per-process authorityRuntimeId so remote restarts preserve cookies.
function pairingAuthorityConnectionIdentity(
  vshuProfileId: string,
  environmentId: string,
  pairingRevision: number,
  connection: PairedRuntimeConnection
): string {
  return connectionIdentityDigest([
    'paired-runtime-browser',
    vshuProfileId,
    environmentId,
    pairingRevision,
    connection.hostPublicKeyB64,
    connection.pairedDeviceId ?? null
  ])
}

// Re-pairing rotates device ids and revisions; the server key still isolates cookie storage.
function deployedAuthorityConnectionIdentity(
  vshuProfileId: string,
  environmentId: string,
  connection: PairedRuntimeConnection
): string {
  return connectionIdentityDigest([
    'paired-runtime-browser-deployed',
    vshuProfileId,
    environmentId,
    connection.hostPublicKeyB64
  ])
}

/** Superseded per-process identity, kept only so its partition can be adopted. */
function legacyAuthorityConnectionIdentity(
  vshuProfileId: string,
  environmentId: string,
  pairingRevision: number,
  authorityRuntimeId: string,
  connection: PairedRuntimeConnection
): string {
  return connectionIdentityDigest([
    'paired-runtime-browser',
    vshuProfileId,
    environmentId,
    pairingRevision,
    authorityRuntimeId,
    connection.hostPublicKeyB64,
    connection.pairedDeviceId ?? null
  ])
}

function connectionIdentityDigest(components: readonly unknown[]): string {
  return `paired-runtime:${createHash('sha256').update(JSON.stringify(components)).digest('hex')}`
}
