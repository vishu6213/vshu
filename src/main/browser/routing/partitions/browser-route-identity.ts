import { createHash } from 'node:crypto'
import { ORIGINAL_BRAND_NAME } from '../../../../shared/branding/legacy-brand-names'

const MAX_IDENTITY_LENGTH = 512
const PARTITION_IDENTITY_VERSION = 1
// Digest labels keep the pre-rebrand spelling: changing them would relocate every cookie jar.
const DIGEST_BRAND = ORIGINAL_BRAND_NAME
const BROWSER_ROUTE_PARTITION_RE = /^persist:vshu-browser-v1-[a-f0-9]{64}$/

export type BrowserRoutePartitionIdentity = Readonly<{
  vshuProfileId: string
  browserProfileId: string
  authorityConnectionIdentity: string
  executionHostIdentity: string
}>

export type DerivedBrowserRoutePartition = Readonly<{
  partition: string
  bindingFingerprint: string
}>

export function deriveBrowserRoutePartition(
  identity: BrowserRoutePartitionIdentity
): DerivedBrowserRoutePartition {
  const components = [
    [`${DIGEST_BRAND}-profile`, identity.vshuProfileId],
    ['browser-profile', identity.browserProfileId],
    ['authority-connection', identity.authorityConnectionIdentity],
    ['execution-host', identity.executionHostIdentity]
  ] as const
  for (const [, value] of components) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      Buffer.byteLength(value, 'utf8') > MAX_IDENTITY_LENGTH
    ) {
      throw new Error('browser_route_partition_identity_invalid')
    }
  }

  return {
    partition: `persist:vshu-browser-v${PARTITION_IDENTITY_VERSION}-${digest([
      `${DIGEST_BRAND}-browser-route-partition`,
      PARTITION_IDENTITY_VERSION,
      ...components
    ])}`,
    bindingFingerprint: digest([
      `${DIGEST_BRAND}-browser-route-partition-binding`,
      PARTITION_IDENTITY_VERSION,
      ...components
    ])
  }
}

// Lifecycle ownership must remain derivable without a live connection.
export function deriveBrowserRoutePartitionStorageScope(scope: {
  vshuProfileId: string
  environmentId: string
}): string {
  return digest([
    `${DIGEST_BRAND}-browser-route-partition-scope`,
    PARTITION_IDENTITY_VERSION,
    [`${DIGEST_BRAND}-profile`, scope.vshuProfileId],
    ['environment', scope.environmentId]
  ])
}

// Use a distinct digest domain for direct SSH ownership, independent of paired environments.
export function deriveLocalSshBrowserRoutePartitionStorageScope(scope: {
  vshuProfileId: string
  targetId: string
}): string {
  return digest([
    `${DIGEST_BRAND}-browser-route-partition-scope`,
    PARTITION_IDENTITY_VERSION,
    [`${DIGEST_BRAND}-profile`, scope.vshuProfileId],
    ['local-ssh-target', scope.targetId]
  ])
}

export function isBrowserRoutePartition(value: string): boolean {
  return BROWSER_ROUTE_PARTITION_RE.test(value)
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}
