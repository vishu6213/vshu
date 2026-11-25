import type { VshuPushPayload } from '../payload-identity/push-payload'

export type NativeDismissal = {
  rememberAll(payloads: readonly VshuPushPayload[]): Promise<void>
  wasDismissed(payload: VshuPushPayload): Promise<boolean>
}
// Android and web use JavaScript storage; iOS requires the native ledger.
export const nativePushDismissal: NativeDismissal | null = null
